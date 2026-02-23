/**
 * POST /api/ai — AI Agent endpoint
 *
 * Accepts { boardId, command, commandId? } in the request body.
 * Verifies JWT, checks board write access, runs the AI agent loop,
 * and streams Server-Sent Events back to the client.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { traceable } from "langsmith/traceable";
import { verifyToken, assertCanWriteBoard, AuthError } from "./_lib/auth.js";
import { hasFastPathMatch, runAgent } from "./_lib/aiAgent.js";
import { fetchBoardState, checkRateLimit } from "./_lib/aiTools.js";
import {
  createAiRun,
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

  // ── Fail-fast checks before any DB work ────────────────
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

  // ── Rate limiting ────────────────────────────────────
  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) {
    res.setHeader("Retry-After", String(rateCheck.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many AI requests. Please wait before trying again.",
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
  }

  const {
    boardId,
    command,
    commandId: rawCommandId,
    conversationHistory,
    viewport,
    screenSize,
    selectedIds,
  } = req.body || {};

  if (!boardId || typeof boardId !== "string") {
    return res.status(400).json({ error: "Missing boardId" });
  }
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    return res.status(400).json({ error: "Missing command" });
  }
  if (command.length > 2000) {
    return res.status(400).json({ error: "Command too long (max 2000 chars)" });
  }

  if (rawCommandId !== undefined && (typeof rawCommandId !== "string" || !isUuid(rawCommandId))) {
    return res.status(400).json({ error: "commandId must be a valid UUID" });
  }

  const commandId = typeof rawCommandId === "string" ? rawCommandId : crypto.randomUUID();
  const trimmedCommand = command.trim();

  // ── Board access check + board state (parallel when possible) ──
  // Running them concurrently saves ~80ms of sequential Supabase latency.
  const hasHistory = Array.isArray(conversationHistory) && conversationHistory.length > 0;
  const hasSelection = Array.isArray(selectedIds) && selectedIds.length > 0;
  const skipBoardStateFetch = !hasHistory && !hasSelection && hasFastPathMatch(trimmedCommand);

  let boardState: unknown = {};
  try {
    if (skipBoardStateFetch) {
      await assertCanWriteBoard(userId, boardId);
    } else {
      const [, bs] = await Promise.all([
        assertCanWriteBoard(userId, boardId),
        fetchBoardState(boardId),
      ]);
      boardState = bs;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Board access check failed" });
  }

  // ── Idempotency: check existing run for this commandId ──
  let aiRun = await findAiRun(boardId, commandId);

  // Recover stale in-progress runs (server crash / Vercel timeout)
  if (aiRun && isInProgressStatus(aiRun.status)) {
    aiRun = await recoverStaleRun(aiRun);
  }

  if (aiRun?.status === "completed") {
    setSseHeaders(res);
    for (const event of replayStoredResponse(aiRun)) {
      writeSse(res, event);
    }
    (res as any).write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  if (aiRun?.status === "needs_confirmation") {
    return res.status(409).json({
      error: "Command requires confirmation",
      commandId,
      status: aiRun.status,
    });
  }

  if (aiRun && isInProgressStatus(aiRun.status)) {
    return res.status(409).json({
      error: "Command is already in progress",
      commandId,
      status: aiRun.status,
    });
  }

  // ── Create or re-use run row ────────────────────────────
  const requestContext = {
    conversationHistory: Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [],
    viewport,
    screenSize,
    selectedIds: Array.isArray(selectedIds) ? selectedIds : [],
  };

  if (!aiRun) {
    aiRun = await createAiRun({
      boardId,
      userId,
      commandId,
      command: trimmedCommand,
      requestContext,
    });

    if (!aiRun) {
      // Race recovery: another request may have inserted with the same commandId.
      aiRun = await findAiRun(boardId, commandId);
      if (!aiRun) {
        return res.status(500).json({ error: "Failed to initialize AI run", commandId });
      }
      if (isInProgressStatus(aiRun.status)) {
        return res.status(409).json({
          error: "Command is already in progress",
          commandId,
          status: aiRun.status,
        });
      }
    }
  } else {
    // Existing run with failed status — update context and retry.
    await updateAiRun(boardId, commandId, {
      status: "started",
      plan_json: { request: requestContext },
    });
  }

  // ── Execute ─────────────────────────────────────────────
  setSseHeaders(res);

  const startedAt = Date.now();
  let responseText = "";
  let model: string | null = null;
  let complexity: string | null = null;
  let contextScope: string | null = null;
  let toolCallsCount = 0;
  let capturedPlan: Record<string, any> | null = null;
  let streamError: string | null = null;

  await updateAiRun(boardId, commandId, { status: "executing" });

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
      name: "CollabBoard Agent",
      run_type: "chain",
      tags: [
        hasSelection ? "has-selection" : "no-selection",
        skipBoardStateFetch ? "fastpath-skip-board-fetch" : "fetched-board-state",
      ],
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
    await runTraceable({ boardId, command: trimmedCommand, userId });

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
