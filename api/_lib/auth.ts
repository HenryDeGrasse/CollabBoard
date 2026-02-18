import { getSupabaseAdmin } from "./supabaseAdmin";

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

/**
 * Verify a Supabase access token from the Authorization header.
 * Returns the user's UUID.
 */
export async function verifyToken(authHeader: string | null): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Missing or malformed Authorization header");
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw new AuthError(401, "Empty token");
  }

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new AuthError(401, "Invalid or expired token");
  }

  return user.id;
}

/**
 * Assert that the user has write access to the board.
 * Checks: board exists + user is a member with editor/owner role.
 */
export async function assertCanWriteBoard(
  uid: string,
  boardId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Check board exists
  const { data: board, error: boardError } = await supabase
    .from("boards")
    .select("id")
    .eq("id", boardId)
    .single();

  if (boardError || !board) {
    throw new AuthError(404, "Board not found");
  }

  // Check membership
  const { data: member, error: memberError } = await supabase
    .from("board_members")
    .select("role")
    .eq("board_id", boardId)
    .eq("user_id", uid)
    .single();

  if (memberError || !member) {
    throw new AuthError(403, "Not authorized to modify this board");
  }

  if (member.role === "viewer") {
    throw new AuthError(403, "Viewers cannot modify the board");
  }
}
