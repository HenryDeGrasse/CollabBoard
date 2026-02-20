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
    fromId: row.from_id ?? "",
    toId: row.to_id ?? "",
    style: row.style,
    fromPoint: row.from_point ?? undefined,
    toPoint: row.to_point ?? undefined,
    color: row.color ?? undefined,
    strokeWidth: row.stroke_width ?? undefined,
  };
}

// ─── Board CRUD ───────────────────────────────────────────────

export interface BoardMetadata {
  id: string;
  title: string;
  ownerId: string;
  visibility: "public" | "private";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface BoardMember {
  userId: string;
  role: "owner" | "editor";
  displayName: string;
}

export interface BoardAccessRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  message: string;
  createdAt: string;
}

export type JoinResult =
  | { status: "member"; role: "owner" | "editor" }
  | { status: "joined" }
  | { status: "private" }
  | { status: "not_found" };

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

/**
 * Fetch all members of a board with their display names.
 * Uses two queries because board_members.user_id → auth.users, not profiles,
 * so PostgREST cannot auto-traverse the profiles relationship in one select.
 */
export async function getBoardMembers(boardId: string): Promise<BoardMember[]> {
  // 1. Get memberships
  const { data: members, error: membersError } = await supabase
    .from("board_members")
    .select("user_id, role")
    .eq("board_id", boardId);

  if (membersError) throw membersError;
  if (!members || members.length === 0) return [];

  // 2. Fetch display names from profiles for those user IDs
  const userIds = members.map((m: any) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);

  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameMap[p.id] = p.display_name || "Unknown User";
  }

  return members.map((m: any) => ({
    userId: m.user_id,
    role: m.role as "owner" | "editor",
    displayName: nameMap[m.user_id] || "Unknown User",
  }));
}

/**
 * Submit an access request for a private board.
 */
export async function requestBoardAccess(
  boardId: string,
  sessionToken: string,
  message?: string
): Promise<void> {
  const res = await fetch("/api/boards/access-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ boardId, message }),
  });

  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to request access");
  }
}

/**
 * Owner-only: list pending access requests for a board.
 */
export async function listBoardAccessRequests(
  boardId: string,
  sessionToken: string
): Promise<BoardAccessRequest[]> {
  const res = await fetch(`/api/boards/access-requests?boardId=${encodeURIComponent(boardId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to load access requests");
  }

  const data = await res.json();
  return (data.requests ?? []) as BoardAccessRequest[];
}

/**
 * Owner-only: approve or deny an access request.
 */
export async function resolveBoardAccessRequest(
  requestId: string,
  decision: "approve" | "deny",
  sessionToken: string
): Promise<void> {
  const res = await fetch("/api/boards/access-requests/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ requestId, decision }),
  });

  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to resolve request");
  }
}

/**
 * Remove a member from a board via the server-side API (bypasses RLS).
 * Owner can remove others; editors can only remove themselves (leave board).
 */
export async function removeBoardMember(
  boardId: string,
  userId: string,
  sessionToken: string
): Promise<void> {
  const res = await fetch("/api/boards/members", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ boardId, userId }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to remove member");
  }
}

/**
 * Update board visibility (owner only).
 */
export async function updateBoardVisibility(
  boardId: string,
  visibility: "public" | "private",
  sessionToken: string
): Promise<void> {
  const res = await fetch("/api/boards/visibility", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ boardId, visibility }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to update visibility");
  }
}

/**
 * Get or create an invite token for a board.
 * Returns the full invite URL the owner can share.
 */
export async function getInviteToken(
  boardId: string,
  sessionToken: string,
  rotate = false
): Promise<string> {
  const res = await fetch("/api/invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ boardId, rotate }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error ?? "Failed to get invite token");
  }
  const { token } = await res.json();
  return token as string;
}

/**
 * Accept an invite token — adds the current user to the board as editor.
 * Returns the boardId and whether they were already a member.
 */
export async function acceptInviteToken(
  token: string,
  sessionToken: string
): Promise<{ boardId: string; alreadyMember: boolean }> {
  const res = await fetch("/api/invites/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to accept invite");
  }
  return res.json();
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

/**
 * Attempt to join a board.
 *
 * - If already a member:   returns { status: "member", role }
 * - If board is public:    inserts as editor, returns { status: "joined" }
 * - If board is private:   returns { status: "private" }  (must use invite link)
 * - If board not found:    returns { status: "not_found" }
 */
export async function joinBoard(boardId: string, userId: string): Promise<JoinResult> {
  // 1. Check existing membership (own rows always readable by RLS)
  const { data: existing } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", boardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return { status: "member", role: existing.role as "owner" | "editor" };

  // 2. Read board visibility (boards SELECT policy allows all authenticated users)
  const { data: board } = await supabase
    .from("boards")
    .select("id, visibility")
    .eq("id", boardId)
    .maybeSingle();

  if (!board) return { status: "not_found" };
  if (board.visibility === "private") return { status: "private" };

  // 3. Public board: self-join as editor
  const { error } = await supabase
    .from("board_members")
    .insert({ board_id: boardId, user_id: userId, role: "editor" });

  if (error) {
    // Race condition — another tab already inserted
    if ((error as any).code === "23505") return { status: "member", role: "editor" };
    throw error;
  }

  return { status: "joined" };
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
