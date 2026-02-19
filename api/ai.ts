/**
 * POST /api/ai — AI Agent endpoint
 *
 * Accepts { boardId, command } in the request body.
 * Verifies JWT, checks board write access, runs the GPT-4o agent loop,
 * and streams Server-Sent Events back to the client.
 *
 * Board mutations go directly through supabaseAdmin → Supabase realtime
 * broadcasts changes to all connected clients automatically.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { traceable } from "langsmith/traceable";
import { verifyToken, assertCanWriteBoard, AuthError } from "./_lib/auth.js";
import { runAgent } from "./_lib/aiAgent.js";
import { fetchBoardState } from "./_lib/aiTools.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth ────────────────────────────────────────────────
  let userId: string;
  try {
    userId = await verifyToken(req.headers.authorization as string | null);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Auth check failed" });
  }

  // ── Input validation ───────────────────────────────────
  const { boardId, command, conversationHistory, viewport, screenSize, selectedIds } = req.body || {};

  if (!boardId || typeof boardId !== "string") {
    return res.status(400).json({ error: "Missing boardId" });
  }
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    return res.status(400).json({ error: "Missing command" });
  }
  if (command.length > 2000) {
    return res.status(400).json({ error: "Command too long (max 2000 chars)" });
  }

  // ── Board access + board state (parallel) ─────────────
  // assertCanWriteBoard and fetchBoardState both only need boardId (plus
  // userId for the access check). Running them concurrently saves ~80 ms of
  // sequential Supabase latency on every request.
  let boardState: unknown;
  try {
    [, boardState] = await Promise.all([
      assertCanWriteBoard(userId, boardId),
      fetchBoardState(boardId),
    ]);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Board access check failed" });
  }

  // ── OpenAI key check ───────────────────────────────────
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  }

  // ── Stream response via SSE ────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Nginx buffering off

  // Wrap the agent run in a traceable so all child LLM calls (from wrapOpenAI)
  // automatically nest under this parent run in LangSmith.
  // traceable is a no-op when LANGSMITH_TRACING is not "true".
  const runTraceable = traceable(
    async (input: { boardId: string; command: string; userId: string }) => {
      const agentStream = runAgent(
        input.boardId, input.userId, input.command,
        openaiApiKey, boardState, viewport, screenSize, conversationHistory, selectedIds
      );

      let responseText = "";
      for await (const event of agentStream) {
        (res as any).write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "text") responseText += event.content;
      }

      // Returned value becomes the trace output in LangSmith
      return { response: responseText };
    },
    {
      name: "CollabBoard Agent",
      run_type: "chain",
      tags: [
        Array.isArray(selectedIds) && selectedIds.length > 0 ? "has-selection" : "no-selection",
      ],
    }
  );

  try {
    await runTraceable({ boardId, command: command.trim(), userId });
  } catch (err: any) {
    const errorEvent = JSON.stringify({
      type: "error",
      content: err.message || "Unexpected error",
    });
    (res as any).write(`data: ${errorEvent}\n\n`);
  }

  // Signal end of stream
  (res as any).write(`data: [DONE]\n\n`);
  res.end();
}
