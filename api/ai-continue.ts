/**
 * POST /api/ai-continue — Resume/replay AI command runs
 *
 * Accepts { boardId, commandId } and either:
 * - replays a completed run's stored response, or
 * - resumes a failed/timed-out run from stored request context.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { traceable } from "langsmith/traceable";
import { verifyToken, assertCanWriteBoard, AuthError } from "./_lib/auth.js";
import { hasFastPathMatch, runAgent } from "./_lib/aiAgent.js";
import { fetchBoardState } from "./_lib/aiTools.js";
import {
  findAiRun,
  isInProgressStatus,
  isUuid,
  markAiRunCompleted,
  markAiRunFailed,
  recoverStaleRun,
  replayStoredResponse,
  updateAiRun,
} from "./_lib/aiRuns.js";

function setSseHeaders(res: VercelResponse) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

function writeSse(res: VercelResponse, event: { type: string; content: string }) {
  (res as any).write(`data: ${JSON.stringify(event)}\n\n`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  }

  let userId: string;
  try {
    userId = await verifyToken(req.headers.authorization as string | null);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Auth check failed" });
  }

  const { boardId, commandId } = req.body || {};

  if (!boardId || typeof boardId !== "string") {
    return res.status(400).json({ error: "Missing boardId" });
  }
  if (!commandId || typeof commandId !== "string" || !isUuid(commandId)) {
    return res.status(400).json({ error: "commandId must be a valid UUID" });
  }

  try {
    await assertCanWriteBoard(userId, boardId);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Board access check failed" });
  }

  let aiRun = await findAiRun(boardId, commandId);
  if (!aiRun) {
    return res.status(404).json({ error: "Run not found", commandId });
  }

  // Security: only the user who created the run can resume/replay it.
  if (aiRun.user_id !== userId) {
    return res.status(403).json({ error: "Not authorized to access this run" });
  }

  // Recover stale in-progress runs (server crash / Vercel timeout)
  if (isInProgressStatus(aiRun.status)) {
    aiRun = await recoverStaleRun(aiRun);
  }

  if (aiRun.status === "completed") {
    setSseHeaders(res);
    for (const event of replayStoredResponse(aiRun)) {
      writeSse(res, event);
    }
    (res as any).write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  if (isInProgressStatus(aiRun.status)) {
    return res.status(409).json({
      error: "Command is already in progress",
      commandId,
      status: aiRun.status,
    });
  }

  // At this point status is 'failed' or 'needs_confirmation' — resumable.
  const requestContext =
    aiRun.plan_json && typeof aiRun.plan_json === "object" && aiRun.plan_json.request
      ? aiRun.plan_json.request
      : {};

  const conversationHistory = Array.isArray(requestContext.conversationHistory)
    ? requestContext.conversationHistory
    : undefined;
  const viewport = requestContext.viewport;
  const screenSize = requestContext.screenSize;
  const selectedIds = Array.isArray(requestContext.selectedIds)
    ? requestContext.selectedIds
    : undefined;

  const hasHistory = Array.isArray(conversationHistory) && conversationHistory.length > 0;
  const hasSelection = Array.isArray(selectedIds) && selectedIds.length > 0;
  const skipBoardStateFetch = !hasHistory && !hasSelection && hasFastPathMatch(aiRun.command);

  let boardState: unknown = {};
  if (!skipBoardStateFetch) {
    boardState = await fetchBoardState(boardId);
  }

  // Single status update — go directly to executing.
  await updateAiRun(boardId, commandId, { status: "executing" });

  setSseHeaders(res);

  const startedAt = Date.now();
  let responseText = "";
  let model: string | null = null;
  let complexity: string | null = null;
  let contextScope: string | null = null;
  let toolCallsCount = 0;
  let capturedPlan: Record<string, any> | null = null;
  let streamError: string | null = null;

  const runTraceable = traceable(
    async (input: { boardId: string; command: string; userId: string }) => {
      const agentStream = runAgent(
        input.boardId,
        input.userId,
        input.command,
        openaiApiKey,
        boardState,
        viewport,
        screenSize,
        conversationHistory,
        selectedIds
      );

      for await (const event of agentStream) {
        writeSse(res, event);

        if (event.type === "text") {
          responseText += event.content;
        } else if (event.type === "meta") {
          try {
            const meta = JSON.parse(event.content) as {
              model?: string;
              complexity?: string;
              contextScope?: string;
            };
            if (meta.model) model = meta.model;
            if (meta.complexity) complexity = meta.complexity;
            if (meta.contextScope) contextScope = meta.contextScope;
          } catch {
            // Ignore malformed meta payloads.
          }
        } else if (event.type === "tool_start") {
          toolCallsCount++;
        } else if (event.type === "plan_ready") {
          try {
            capturedPlan = JSON.parse(event.content);
          } catch {
            capturedPlan = null;
          }
        } else if (event.type === "error") {
          streamError = event.content || "Agent error";
        }
      }

      return { response: responseText };
    },
    {
      name: "CollabBoard Agent Continue",
      run_type: "chain",
      tags: ["resume", skipBoardStateFetch ? "fastpath-skip-board-fetch" : "fetched-board-state"],
    }
  );

  const responseMeta = () => ({
    responseText,
    meta: { model, complexity, contextScope },
    plan: capturedPlan,
  });

  const planMeta = () => ({
    request: requestContext,
    plan: capturedPlan,
  });

  try {
    await runTraceable({ boardId, command: aiRun.command, userId });

    const durationMs = Date.now() - startedAt;

    if (streamError) {
      await markAiRunFailed({
        boardId,
        commandId,
        model,
        toolCallsCount,
        durationMs,
        error: streamError,
        response: responseMeta(),
        plan: planMeta(),
      });
    } else {
      await markAiRunCompleted({
        boardId,
        commandId,
        model,
        toolCallsCount,
        durationMs,
        response: responseMeta(),
        plan: planMeta(),
      });
    }
  } catch (err: any) {
    const errorMessage = err?.message || "Unexpected error";
    writeSse(res, { type: "error", content: errorMessage });

    await markAiRunFailed({
      boardId,
      commandId,
      model,
      toolCallsCount,
      durationMs: Date.now() - startedAt,
      error: errorMessage,
      response: responseMeta(),
      plan: planMeta(),
    });
  }

  (res as any).write(`data: [DONE]\n\n`);
  res.end();
}
