import { getSupabaseAdmin } from "../supabaseAdmin.js";

/**
 * Get the current board version.
 */
export async function getBoardVersion(boardId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("boards")
    .select("version")
    .eq("id", boardId)
    .single();
  if (error) throw error;
  return data?.version ?? 0;
}

/**
 * Atomically increment board version. Returns the new version number.
 */
export async function incrementBoardVersion(boardId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("increment_board_version", {
    p_board_id: boardId,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Check whether the board version matches expected.
 * Returns { ok: true } or { ok: false, currentVersion }.
 */
export async function checkBoardVersion(
  boardId: string,
  expectedVersion: number
): Promise<{ ok: true } | { ok: false; currentVersion: number }> {
  const current = await getBoardVersion(boardId);
  if (current !== expectedVersion) {
    return { ok: false, currentVersion: current };
  }
  return { ok: true };
}

/**
 * Create an object with idempotent client_id.
 * If client_id already exists for this board, returns the existing object id
 * instead of inserting a duplicate.
 */
export async function idempotentCreateObject(
  boardId: string,
  clientId: string,
  row: Record<string, any>
): Promise<{ id: string; alreadyExisted: boolean }> {
  const supabase = getSupabaseAdmin();

  // Check if this client_id already exists (retry scenario)
  const { data: existing } = await supabase
    .from("objects")
    .select("id")
    .eq("board_id", boardId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing) {
    return { id: existing.id, alreadyExisted: true };
  }

  // Insert with client_id
  const { data, error } = await supabase
    .from("objects")
    .insert({ ...row, board_id: boardId, client_id: clientId })
    .select("id")
    .single();

  if (error) {
    // Handle race condition: unique constraint violation means another retry won
    if ((error as any).code === "23505") {
      const { data: raced } = await supabase
        .from("objects")
        .select("id")
        .eq("board_id", boardId)
        .eq("client_id", clientId)
        .single();
      if (raced) return { id: raced.id, alreadyExisted: true };
    }
    throw error;
  }

  return { id: data.id, alreadyExisted: false };
}

/**
 * Save/update the AI job's progress for resumability.
 */
export async function updateJobProgress(
  boardId: string,
  commandId: string,
  updates: {
    status?: string;
    currentStep?: number;
    totalSteps?: number;
    boardVersionStart?: number;
    boardVersionEnd?: number;
    planJson?: any;
    response?: any;
  }
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const row: Record<string, any> = {};
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.currentStep !== undefined) row.current_step = updates.currentStep;
  if (updates.totalSteps !== undefined) row.total_steps = updates.totalSteps;
  if (updates.boardVersionStart !== undefined) row.board_version_start = updates.boardVersionStart;
  if (updates.boardVersionEnd !== undefined) row.board_version_end = updates.boardVersionEnd;
  if (updates.planJson !== undefined) row.plan_json = updates.planJson;
  if (updates.response !== undefined) row.response = updates.response;

  if (Object.keys(row).length === 0) return;

  await supabase
    .from("ai_runs")
    .update(row)
    .eq("board_id", boardId)
    .eq("command_id", commandId);
}

/**
 * Load a job for resumption. Returns null if not found.
 */
export async function loadJob(
  boardId: string,
  commandId: string
): Promise<{
  status: string;
  currentStep: number;
  totalSteps: number;
  boardVersionStart: number | null;
  planJson: any;
  command: string;
} | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_runs")
    .select("status, current_step, total_steps, board_version_start, plan_json, command")
    .eq("board_id", boardId)
    .eq("command_id", commandId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    status: data.status,
    currentStep: data.current_step ?? 0,
    totalSteps: data.total_steps ?? 0,
    boardVersionStart: data.board_version_start,
    planJson: data.plan_json,
    command: data.command,
  };
}
