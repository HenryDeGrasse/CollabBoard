import { supabase } from "./supabase";
import type { BoardAccessRequest, BoardMember, JoinResult } from "./board-types";

/**
 * Fetch all members of a board with their display names.
 * Uses the server-side API endpoint (service role) so the RLS policy that
 * restricts each user to their own row does not hide other members.
 */
export async function getBoardMembers(boardId: string, sessionToken?: string): Promise<BoardMember[]> {
  const headers: Record<string, string> = {};
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;

  const res = await fetch(`/api/boards/members?boardId=${encodeURIComponent(boardId)}`, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to load members");
  }

  const data = await res.json();
  return (data.members ?? []) as BoardMember[];
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
