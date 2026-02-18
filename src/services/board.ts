import { supabase } from "./supabase";
import type { BoardObject, Connector } from "../types/board";

// ─── Type Mappings (DB snake_case ↔ App camelCase) ────────────

function dbToObject(row: any): BoardObject {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    color: row.color,
    text: row.text || "",
    textSize: row.text_size ?? null,
    textColor: row.text_color ?? null,
    textVerticalAlign: row.text_vertical_align ?? null,
    rotation: row.rotation,
    zIndex: row.z_index,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    parentFrameId: row.parent_frame_id || null,
    points: row.points || undefined,
    strokeWidth: row.stroke_width || undefined,
  };
}

function objectToDb(obj: Partial<BoardObject> & { boardId?: string }) {
  const row: Record<string, any> = {};
  if (obj.boardId !== undefined) row.board_id = obj.boardId;
  if (obj.type !== undefined) row.type = obj.type;
  if (obj.x !== undefined) row.x = obj.x;
  if (obj.y !== undefined) row.y = obj.y;
  if (obj.width !== undefined) row.width = obj.width;
  if (obj.height !== undefined) row.height = obj.height;
  if (obj.color !== undefined) row.color = obj.color;
  if (obj.text !== undefined) row.text = obj.text;
  if (obj.textSize !== undefined) row.text_size = obj.textSize;
  if (obj.textColor !== undefined) row.text_color = obj.textColor;
  if (obj.textVerticalAlign !== undefined) row.text_vertical_align = obj.textVerticalAlign;
  if (obj.rotation !== undefined) row.rotation = obj.rotation;
  if (obj.zIndex !== undefined) row.z_index = obj.zIndex;
  if (obj.createdBy !== undefined) row.created_by = obj.createdBy;
  if (obj.parentFrameId !== undefined) row.parent_frame_id = obj.parentFrameId;
  if (obj.points !== undefined) row.points = obj.points;
  if (obj.strokeWidth !== undefined) row.stroke_width = obj.strokeWidth;
  return row;
}

function dbToConnector(row: any): Connector {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    style: row.style,
  };
}

// ─── Board CRUD ───────────────────────────────────────────────

export interface BoardMetadata {
  id: string;
  title: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export async function createBoard(title: string, ownerId: string): Promise<string> {
  // Generate board ID client-side so INSERT does not require SELECT/RETURNING.
  // This avoids RLS failures when the board is not yet visible via membership policy.
  const boardId = crypto.randomUUID();

  const { error: boardError } = await supabase
    .from("boards")
    .insert({ id: boardId, title, owner_id: ownerId });

  if (boardError) throw boardError;

  // Add owner as member
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
    .select("board_id, boards(id, title, owner_id, created_at, updated_at, deleted_at)")
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
    .select("id, title, owner_id, created_at, updated_at, deleted_at")
    .eq("id", boardId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    ownerId: data.owner_id,
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

export async function joinBoard(boardId: string, userId: string): Promise<void> {
  // Avoid duplicate insert attempts by checking whether this user is already a member.
  // board_members SELECT policy allows users to read their own memberships.
  const { data: existingMembership, error: existingError } = await supabase
    .from("board_members")
    .select("board_id")
    .eq("board_id", boardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingMembership) {
    return;
  }

  const { error } = await supabase
    .from("board_members")
    .insert({ board_id: boardId, user_id: userId, role: "editor" });

  if (error) {
    const code = (error as { code?: string }).code;

    // Already a member (race between tabs)
    if (code === "23505") {
      return;
    }

    // FK violation: board_id does not exist
    if (code === "23503") {
      throw new Error("Board not found");
    }

    throw error;
  }
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
 */
export async function restoreObjects(boardId: string, objects: BoardObject[]): Promise<void> {
  // Sort: frames/unparented first, children second
  const sorted = [...objects].sort((a, b) => {
    const aChild = a.parentFrameId ? 1 : 0;
    const bChild = b.parentFrameId ? 1 : 0;
    return aChild - bChild;
  });

  // Upsert sequentially to respect FK ordering.
  // Upsert (not insert) so rapid undo/redo doesn't fail if a prior
  // delete hasn't committed yet.
  for (const obj of sorted) {
    const row = objectToDb({ ...obj, boardId } as any);
    row.board_id = boardId;
    row.id = obj.id;
    const { error } = await supabase.from("objects").upsert(row);
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
      from_id: conn.fromId,
      to_id: conn.toId,
      style: conn.style,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
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

/**
 * Re-insert a connector preserving its original ID (for undo).
 * Uses upsert so it's idempotent if the prior delete hasn't committed yet.
 */
export async function restoreConnector(boardId: string, conn: Connector): Promise<void> {
  const { error } = await supabase.from("connectors").upsert({
    id: conn.id,
    board_id: boardId,
    from_id: conn.fromId,
    to_id: conn.toId,
    style: conn.style,
  });
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
