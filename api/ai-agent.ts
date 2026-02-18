import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, assertCanWriteBoard, AuthError } from "./_lib/auth.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { executeAICommand } from "./_lib/ai/agent.js";

// ─── Rate Limiting (in-memory, per cold start) ───────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// ─── Request Validation ───────────────────────────────────────

interface AICommandPayload {
  commandId: string;
  boardId: string;
  command: string;
  viewport: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    centerX: number;
    centerY: number;
    scale: number;
  };
  selectedObjectIds: string[];
  pointer?: { x: number; y: number };
}

function validatePayload(body: any): AICommandPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const { commandId, boardId, command, viewport, selectedObjectIds } = body;

  if (!commandId || typeof commandId !== "string")
    throw new Error("Missing commandId");
  if (!boardId || typeof boardId !== "string")
    throw new Error("Missing boardId");
  if (!command || typeof command !== "string")
    throw new Error("Missing command");
  if (command.length > 1000)
    throw new Error("Command too long (max 1000 chars)");

  if (!viewport || typeof viewport !== "object")
    throw new Error("Missing viewport");
  for (const key of [
    "minX",
    "minY",
    "maxX",
    "maxY",
    "centerX",
    "centerY",
    "scale",
  ]) {
    if (typeof viewport[key] !== "number" || isNaN(viewport[key])) {
      throw new Error(`Invalid viewport.${key}`);
    }
  }

  if (!Array.isArray(selectedObjectIds))
    throw new Error("Missing selectedObjectIds");

  return {
    commandId,
    boardId,
    command: command.slice(0, 1000),
    viewport,
    selectedObjectIds: selectedObjectIds
      .filter((id: any) => typeof id === "string")
      .slice(0, 50),
    pointer: body.pointer,
  };
}

// ─── Handler ──────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Verify token → uid
    const uid = await verifyToken(req.headers.authorization ?? null);

    // 2. Validate payload
    const payload = validatePayload(req.body);

    // 3. Authorize: user can write to this board
    await assertCanWriteBoard(uid, payload.boardId);

    // 4. Rate limit
    if (!checkRateLimit(uid)) {
      return res
        .status(429)
        .json({ error: "Rate limit exceeded (10 commands/minute)" });
    }

    // 5. Idempotency check via Supabase
    const supabase = getSupabaseAdmin();

    const { data: existingRun } = await supabase
      .from("ai_runs")
      .select("status, response, created_at")
      .eq("board_id", payload.boardId)
      .eq("command_id", payload.commandId)
      .single();

    if (existingRun) {
      if (existingRun.status === "completed" && existingRun.response) {
        return res.status(200).json(existingRun.response);
      }
      // If "started" but not completed, allow retry after 30s
      const startedAt = new Date(existingRun.created_at).getTime();
      if (existingRun.status === "started" && Date.now() - startedAt < 30_000) {
        return res
          .status(409)
          .json({ error: "Command already in progress" });
      }
    }

    // Mark as started
    await supabase.from("ai_runs").upsert({
      command_id: payload.commandId,
      board_id: payload.boardId,
      user_id: uid,
      command: payload.command,
      status: "started",
    }, { onConflict: "board_id,command_id" });

    // 6. Check OpenAI API key
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      await supabase
        .from("ai_runs")
        .update({ status: "failed" })
        .eq("board_id", payload.boardId)
        .eq("command_id", payload.commandId);
      return res
        .status(500)
        .json({ error: "AI service not configured" });
    }

    // 7. Execute AI command (pass commandId for progress tracking)
    const result = await executeAICommand(
      payload.command,
      payload.boardId,
      uid,
      payload.viewport,
      payload.selectedObjectIds,
      openaiApiKey,
      payload.commandId
    );

    // 8. Build response
    const response = {
      success: result.success,
      message: result.message,
      objectsCreated: result.objectsCreated,
      objectsUpdated: result.objectsUpdated,
      objectsDeleted: result.objectsDeleted,
      focus: result.focus,
      runId: payload.commandId,
    };

    // 9. Log and mark completed
    await supabase
      .from("ai_runs")
      .update({
        status: "completed",
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        total_tokens: result.totalTokens,
        tool_calls_count: result.toolCallsCount,
        objects_created: result.objectsCreated,
        objects_updated: result.objectsUpdated,
        duration_ms: result.durationMs,
        response,
      })
      .eq("board_id", payload.boardId)
      .eq("command_id", payload.commandId);

    return res.status(200).json(response);
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error("AI agent error:", error);
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
}
