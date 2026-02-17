import { getAdminAuth, getAdminDb } from "./firebaseAdmin";

/**
 * Verify Firebase ID token from Authorization header.
 * Returns the uid. Throws on invalid/missing token.
 */
export async function verifyToken(authHeader: string | null): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Missing or malformed Authorization header");
  }

  const idToken = authHeader.slice(7);
  if (!idToken) {
    throw new AuthError(401, "Empty token");
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    throw new AuthError(401, "Invalid or expired token");
  }
}

/**
 * Assert that the user has access to the board.
 * Checks: board exists + user has membership (userBoards/{uid}/{boardId}).
 */
export async function assertCanWriteBoard(uid: string, boardId: string): Promise<void> {
  const db = getAdminDb();

  // Check board exists
  const metadataSnap = await db.ref(`boards/${boardId}/metadata`).once("value");
  if (!metadataSnap.exists()) {
    throw new AuthError(404, "Board not found");
  }

  // Check user membership
  const membershipSnap = await db.ref(`userBoards/${uid}/${boardId}`).once("value");
  if (!membershipSnap.exists()) {
    throw new AuthError(403, "Not authorized to modify this board");
  }
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}
