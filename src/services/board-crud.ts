import { supabase } from "./supabase";
import type { BoardObject, Connector } from "../types/board";
import { dbToObject, objectToDb, dbToConnector } from "./board-types";
import type { BoardMetadata } from "./board-types";

// ─── Board CRUD ───────────────────────────────────────────────

export async function createBoard(
  title: string,
  ownerId: string,
  visibility: "public" | "private" = "public"
): Promise<string> {
  // Generate board ID client-side so INSERT does not require SELECT/RETURNING.
  const boardId = crypto.randomUUID();

  const { error: boardError } = await supabase
    .from("boards")
    .insert({ id: boardId, title, owner_id: ownerId, visibility });

  if (boardError) throw boardError;

  // Add owner as member (role='owner' is allowed by RLS for any visibility)
  const { error: memberError } = await supabase.from("board_members").insert({
    board_id: boardId,
    user_id: ownerId,
    role: "owner",
  });

  if (memberError) throw memberError;

  return boardId;
}

export async function getUserBoards(userId: string): Promise<BoardMetadata[]> {
  const { data, error } = await supabase
    .from("board_members")
    .select("board_id, boards(id, title, owner_id, visibility, created_at, updated_at, deleted_at)")
    .eq("user_id", userId);

  if (error) throw error;
  if (!data) return [];

  return data
    .map((row: any) => {
      const b = row.boards;
      if (!b || b.deleted_at) return null;
      return {
        id: b.id,
        title: b.title,
        ownerId: b.owner_id,
        visibility: b.visibility ?? "public",
        createdAt: new Date(b.created_at).getTime(),
        updatedAt: new Date(b.updated_at).getTime(),
        deletedAt: b.deleted_at ? new Date(b.deleted_at).getTime() : null,
      };
    })
    .filter(Boolean) as BoardMetadata[];
}

export async function fetchBoardMetadata(boardId: string): Promise<BoardMetadata | null> {
  const { data, error } = await supabase
    .from("boards")
    .select("id, title, owner_id, visibility, created_at, updated_at, deleted_at")
    .eq("id", boardId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    ownerId: data.owner_id,
    visibility: data.visibility ?? "public",
    createdAt: new Date(data.created_at).getTime(),
    updatedAt: new Date(data.updated_at).getTime(),
    deletedAt: data.deleted_at ? new Date(data.deleted_at).getTime() : null,
  };
}

export async function updateBoardMetadata(
  boardId: string,
  updates: Partial<{ title: string }>
): Promise<void> {
  const { error } = await supabase
    .from("boards")
    .update(updates)
    .eq("id", boardId);
  if (error) throw error;
}

export async function softDeleteBoard(boardId: string): Promise<void> {
  const { error } = await supabase
    .from("boards")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", boardId);
  if (error) throw error;
}

export async function touchBoard(boardId: string): Promise<void> {
  await supabase
    .from("boards")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", boardId);
}

// ─── Object CRUD ──────────────────────────────────────────────

export async function fetchBoardObjects(boardId: string): Promise<Record<string, BoardObject>> {
  const { data, error } = await supabase
    .from("objects")
    .select("*")
    .eq("board_id", boardId);

  if (error) throw error;
  const result: Record<string, BoardObject> = {};
  for (const row of data || []) {
    result[row.id] = dbToObject(row);
  }
  return result;
}

export async function createObject(
  boardId: string,
  obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const row = objectToDb({ ...obj, boardId } as any);
  row.board_id = boardId;

  const { data, error } = await supabase
    .from("objects")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

const BATCH_INSERT_CHUNK_SIZE = 200;

/**
 * Insert multiple objects in one or more batched round-trips.
 * Returns the real DB IDs in the same order as the input array.
 * Used for bulk-create scenarios (stress tests, AI-generated boards, paste).
 */
export async function createObjects(
  boardId: string,
  objs: Omit<BoardObject, "id" | "createdAt" | "updatedAt">[]
): Promise<string[]> {
  if (objs.length === 0) return [];

  const rows = objs.map((obj) => {
    const row = objectToDb({ ...obj, boardId } as any);
    row.board_id = boardId;
    return row;
  });

  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += BATCH_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + BATCH_INSERT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("objects")
      .insert(chunk)
      .select("id");
    if (error) throw error;
    ids.push(...(data ?? []).map((r: any) => r.id));
  }
  return ids;
}

export async function updateObject(
  boardId: string,
  objectId: string,
  updates: Partial<BoardObject>
): Promise<void> {
  const row = objectToDb(updates);
  const { error } = await supabase
    .from("objects")
    .update(row)
    .eq("id", objectId)
    .eq("board_id", boardId);
  if (error) throw error;
}

const BULK_UPSERT_CHUNK_SIZE = 200;

/**
 * Bulk-upsert full object rows in chunks.
 *
 * Used by drag/resize flushes so many pending position updates can be written
 * in a handful of round-trips instead of N individual update calls.
 */
export async function updateObjectsBulk(
  boardId: string,
  objects: BoardObject[]
): Promise<void> {
  if (objects.length === 0) return;

  const nowIso = new Date().toISOString();
  const rows = objects.map((obj) => {
    const row = objectToDb({ ...obj, boardId } as any);
    row.id = obj.id;
    row.board_id = boardId;
    row.updated_at = nowIso;
    return row;
  });

  for (let i = 0; i < rows.length; i += BULK_UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + BULK_UPSERT_CHUNK_SIZE);
    const { error } = await supabase
      .from("objects")
      .upsert(chunk, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function deleteObject(boardId: string, objectId: string): Promise<void> {
  const { error } = await supabase
    .from("objects")
    .delete()
    .eq("id", objectId)
    .eq("board_id", boardId);
  if (error) throw error;
}

/**
 * Restore multiple objects in FK-safe order (frames before children).
 * Used by undo to restore a frame and its contained objects.
 *
 * Objects are split into two batches — roots (frames + unparented) first,
 * then children — so the FK constraint (parent_frame_id → objects.id) is
 * satisfied. Each batch is a single DB round-trip instead of N sequential
 * calls, reducing undo latency from O(N × RTT) to O(2 × RTT).
 */
export async function restoreObjects(boardId: string, objects: BoardObject[]): Promise<void> {
  if (objects.length === 0) return;

  // Partition into roots (no FK dependency) and children (depend on parent frame).
  const roots: typeof objects = [];
  const children: typeof objects = [];
  for (const obj of objects) {
    (obj.parentFrameId ? children : roots).push(obj);
  }

  const toRow = (obj: BoardObject) => {
    const row = objectToDb({ ...obj, boardId } as any);
    row.board_id = boardId;
    row.id = obj.id;
    return row;
  };

  // Upsert roots first, then children — respects FK ordering.
  // Upsert (not insert) so rapid undo/redo doesn't fail if a prior
  // delete hasn't committed yet.
  if (roots.length > 0) {
    const { error } = await supabase.from("objects").upsert(roots.map(toRow));
    if (error) throw error;
  }

  if (children.length > 0) {
    const { error } = await supabase.from("objects").upsert(children.map(toRow));
    if (error) throw error;
  }
}

/**
 * Delete a frame and all contained objects atomically.
 * Uses a Postgres RPC so collaborators observe a single consistent cascade.
 */
export async function deleteFrameCascade(boardId: string, frameId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_frame_cascade", {
    p_board_id: boardId,
    p_frame_id: frameId,
  });

  if (error) throw error;
}

/**
 * Re-insert an object preserving its original ID (for undo).
 * Uses upsert so it's idempotent if the prior delete hasn't committed yet.
 */
export async function restoreObject(boardId: string, obj: BoardObject): Promise<void> {
  const row = objectToDb({ ...obj, boardId } as any);
  row.board_id = boardId;
  row.id = obj.id;
  const { error } = await supabase.from("objects").upsert(row);
  if (error) throw error;
}

// ─── Connector CRUD ───────────────────────────────────────────

export async function fetchBoardConnectors(boardId: string): Promise<Record<string, Connector>> {
  const { data, error } = await supabase
    .from("connectors")
    .select("*")
    .eq("board_id", boardId);

  if (error) throw error;
  const result: Record<string, Connector> = {};
  for (const row of data || []) {
    result[row.id] = dbToConnector(row);
  }
  return result;
}

export async function createConnector(
  boardId: string,
  conn: Omit<Connector, "id">
): Promise<string> {
  const { data, error } = await supabase
    .from("connectors")
    .insert({
      board_id: boardId,
      from_id: conn.fromId || null,
      to_id: conn.toId || null,
      style: conn.style,
      from_point: conn.fromPoint ?? null,
      to_point: conn.toPoint ?? null,
      color: conn.color ?? null,
      stroke_width: conn.strokeWidth ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Re-insert a connector preserving its original ID (for undo).
 * Uses upsert so it's idempotent if the prior delete hasn't committed yet.
 */
export async function restoreConnector(boardId: string, conn: Connector): Promise<void> {
  const { error } = await supabase.from("connectors").upsert({
    id: conn.id,
    board_id: boardId,
    from_id: conn.fromId || null,
    to_id: conn.toId || null,
    style: conn.style,
    from_point: conn.fromPoint ?? null,
    to_point: conn.toPoint ?? null,
    color: conn.color ?? null,
    stroke_width: conn.strokeWidth ?? null,
  });
  if (error) throw error;
}

export async function updateConnector(
  boardId: string,
  connectorId: string,
  updates: Partial<Pick<Connector, "color" | "strokeWidth">>
): Promise<void> {
  const row: Record<string, any> = {};
  if (updates.color !== undefined) row.color = updates.color || null;
  if (updates.strokeWidth !== undefined) row.stroke_width = updates.strokeWidth || null;
  const { error } = await supabase
    .from("connectors")
    .update(row)
    .eq("id", connectorId)
    .eq("board_id", boardId);
  if (error) throw error;
}

export async function deleteConnector(boardId: string, connectorId: string): Promise<void> {
  const { error } = await supabase
    .from("connectors")
    .delete()
    .eq("id", connectorId)
    .eq("board_id", boardId);
  if (error) throw error;
}
