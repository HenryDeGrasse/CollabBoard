import { getSupabaseAdmin } from "./supabaseAdmin.js";

export type AiRunStatus =
  | "started"
  | "planning"
  | "executing"
  | "completed"
  | "failed"
  | "resuming"
  | "needs_confirmation";

export interface AiRunRow {
  id: string;
  board_id: string;
  user_id: string;
  command_id: string;
  command: string;
  status: AiRunStatus;
  model: string | null;
  tool_calls_count: number | null;
  current_step: number | null;
  total_steps: number | null;
  board_version_start: number | null;
  board_version_end: number | null;
  duration_ms: number | null;
  response: any;
  plan_json: any;
  created_at: string;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isInProgressStatus(status: AiRunStatus): boolean {
  return status === "started" || status === "planning" || status === "executing" || status === "resuming";
}

export function isTerminalStatus(status: AiRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "needs_confirmation";
}

/**
 * Stale run detection: if an in-progress run was created more than
 * STALE_RUN_THRESHOLD_MS ago, treat it as failed (Vercel timeout / crash).
 * Vercel serverless functions have a max duration of 60s (hobby) or 300s (pro).
 * We use 5 minutes as a generous upper bound.
 */
const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000;

export function isStaleRun(run: AiRunRow): boolean {
  if (!isInProgressStatus(run.status)) return false;
  const age = Date.now() - new Date(run.created_at).getTime();
  return age > STALE_RUN_THRESHOLD_MS;
}

/**
 * If the run is stale (in-progress but too old), mark it failed and return
 * the updated status. Otherwise return the run unchanged.
 */
export async function recoverStaleRun(run: AiRunRow): Promise<AiRunRow> {
  if (!isStaleRun(run)) return run;

  await updateAiRun(run.board_id, run.command_id, {
    status: "failed",
    duration_ms: Date.now() - new Date(run.created_at).getTime(),
    response: {
      ...(run.response && typeof run.response === "object" ? run.response : {}),
      error: "Run timed out (server did not complete within deadline)",
    },
  });

  return { ...run, status: "failed" };
}

export async function getBoardVersion(boardId: string): Promise<number | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("boards")
    .select("version")
    .eq("id", boardId)
    .maybeSingle();

  if (error) return null;
  if (!data || typeof data.version !== "number") return null;
  return data.version;
}

export async function findAiRun(
  boardId: string,
  commandId: string
): Promise<AiRunRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_runs")
    .select("*")
    .eq("board_id", boardId)
    .eq("command_id", commandId)
    .maybeSingle();

  if (error || !data) return null;
  return data as AiRunRow;
}

export async function createAiRun(input: {
  boardId: string;
  userId: string;
  commandId: string;
  command: string;
  requestContext: Record<string, any>;
}): Promise<AiRunRow | null> {
  const supabase = getSupabaseAdmin();
  const startVersion = await getBoardVersion(input.boardId);

  const { data, error } = await supabase
    .from("ai_runs")
    .insert({
      board_id: input.boardId,
      user_id: input.userId,
      command_id: input.commandId,
      command: input.command,
      status: "started",
      current_step: 0,
      total_steps: 0,
      board_version_start: startVersion,
      plan_json: { request: input.requestContext },
      response: null,
    })
    .select("*")
    .maybeSingle();

  if (error || !data) return null;
  return data as AiRunRow;
}

export async function updateAiRun(
  boardId: string,
  commandId: string,
  patch: Record<string, any>
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("ai_runs")
    .update(patch)
    .eq("board_id", boardId)
    .eq("command_id", commandId);
}

export async function markAiRunCompleted(input: {
  boardId: string;
  commandId: string;
  model: string | null;
  toolCallsCount: number;
  durationMs: number;
  response: Record<string, any>;
  plan?: Record<string, any> | null;
}): Promise<void> {
  const endVersion = await getBoardVersion(input.boardId);

  await updateAiRun(input.boardId, input.commandId, {
    status: "completed",
    model: input.model,
    tool_calls_count: input.toolCallsCount,
    board_version_end: endVersion,
    duration_ms: input.durationMs,
    response: input.response,
    ...(input.plan ? { plan_json: input.plan } : {}),
  });
}

export async function markAiRunFailed(input: {
  boardId: string;
  commandId: string;
  model: string | null;
  toolCallsCount: number;
  durationMs: number;
  error: string;
  response?: Record<string, any>;
  plan?: Record<string, any> | null;
}): Promise<void> {
  await updateAiRun(input.boardId, input.commandId, {
    status: "failed",
    model: input.model,
    tool_calls_count: input.toolCallsCount,
    duration_ms: input.durationMs,
    response: {
      ...(input.response || {}),
      error: input.error,
    },
    ...(input.plan ? { plan_json: input.plan } : {}),
  });
}

export function replayStoredResponse(run: AiRunRow) {
  const response = run.response && typeof run.response === "object" ? run.response : {};

  const events: Array<{ type: string; content: string }> = [];

  if (response?.meta && typeof response.meta === "object") {
    events.push({ type: "meta", content: JSON.stringify(response.meta) });
  }

  if (response?.plan && typeof response.plan === "object") {
    events.push({ type: "plan_ready", content: JSON.stringify(response.plan) });
  }

  if (typeof response?.responseText === "string" && response.responseText.length > 0) {
    events.push({ type: "text", content: response.responseText });
  }

  if (typeof response?.error === "string" && response.error.length > 0) {
    events.push({ type: "error", content: response.error });
  }

  events.push({ type: "done", content: "" });

  return events;
}
