import * as admin from "firebase-admin";

/**
 * Assert that the user has access to the board.
 * Checks: board exists + user has membership (userBoards/{uid}/{boardId}).
 */
export async function assertCanWriteBoard(uid: string, boardId: string): Promise<void> {
  const db = admin.database();

  // Check board exists
  const metadataSnap = await db.ref(`boards/${boardId}/metadata`).once("value");
  if (!metadataSnap.exists()) {
    throw new Error("Board not found");
  }

  // Check user membership
  const membershipSnap = await db.ref(`userBoards/${uid}/${boardId}`).once("value");
  if (!membershipSnap.exists()) {
    throw new Error("Not authorized to modify this board");
  }
}
