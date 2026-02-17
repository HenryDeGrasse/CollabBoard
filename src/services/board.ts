import {
  ref,
  push,
  set,
  update,
  remove,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onValue,
  serverTimestamp,
  get,
  off,
  query,
  orderByChild,
  equalTo,
} from "firebase/database";
import { db } from "./firebase";
import type { BoardObject, Connector, BoardMetadata } from "../types/board";

// ─── Board Metadata ───────────────────────────────────────────

export async function createBoard(boardId: string, title: string, ownerId: string, ownerName: string) {
  const metadata: BoardMetadata = {
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ownerId,
    ownerName,
  };
  await set(ref(db, `boards/${boardId}/metadata`), metadata);
  // Also index the board under the user's boards list
  await set(ref(db, `userBoards/${ownerId}/${boardId}`), true);
}

export async function getBoardMetadata(boardId: string): Promise<BoardMetadata | null> {
  const snapshot = await get(ref(db, `boards/${boardId}/metadata`));
  return snapshot.val();
}

export async function updateBoardMetadata(boardId: string, updates: Partial<BoardMetadata>) {
  return update(ref(db, `boards/${boardId}/metadata`), { ...updates, updatedAt: Date.now() });
}

export async function softDeleteBoard(boardId: string) {
  return update(ref(db, `boards/${boardId}/metadata`), { deleted: true, updatedAt: Date.now() });
}

/**
 * Get all board IDs for a user
 */
export async function getUserBoardIds(userId: string): Promise<string[]> {
  const snapshot = await get(ref(db, `userBoards/${userId}`));
  if (!snapshot.exists()) return [];
  return Object.keys(snapshot.val());
}

/**
 * Get metadata for multiple boards at once
 */
export async function getBoardsMetadata(boardIds: string[]): Promise<Record<string, BoardMetadata>> {
  const results: Record<string, BoardMetadata> = {};
  await Promise.all(
    boardIds.map(async (id) => {
      const meta = await getBoardMetadata(id);
      if (meta && !meta.deleted) {
        results[id] = meta;
      }
    })
  );
  return results;
}

/**
 * Subscribe to real-time updates for a user's board list
 */
export function subscribeToUserBoards(
  userId: string,
  onUpdate: (boardIds: string[]) => void
) {
  const userBoardsRef = ref(db, `userBoards/${userId}`);
  const unsub = onValue(userBoardsRef, (snapshot) => {
    if (snapshot.exists()) {
      onUpdate(Object.keys(snapshot.val()));
    } else {
      onUpdate([]);
    }
  });
  return () => off(userBoardsRef);
}

/**
 * Add a board to a user's board list (for joining shared boards)
 */
export function addBoardToUser(userId: string, boardId: string) {
  return set(ref(db, `userBoards/${userId}/${boardId}`), true);
}

/**
 * Touch updatedAt for a board (call on object changes)
 */
export function touchBoard(boardId: string) {
  return update(ref(db, `boards/${boardId}/metadata`), { updatedAt: Date.now() });
}

// ─── Board Objects ────────────────────────────────────────────

// Remove undefined values that Firebase rejects
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const clean = { ...obj };
  for (const key of Object.keys(clean)) {
    if (clean[key] === undefined) {
      delete clean[key];
    }
  }
  return clean;
}

export function createObject(boardId: string, obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">): string {
  const objectsRef = ref(db, `boards/${boardId}/objects`);
  const newRef = push(objectsRef);
  const id = newRef.key!;
  const fullObj = stripUndefined({
    ...obj,
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  set(newRef, fullObj);
  return id;
}

export function updateObject(boardId: string, objectId: string, updates: Partial<BoardObject>) {
  const objectRef = ref(db, `boards/${boardId}/objects/${objectId}`);
  return update(objectRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export function deleteObject(boardId: string, objectId: string) {
  return remove(ref(db, `boards/${boardId}/objects/${objectId}`));
}

// Restore a previously deleted object (preserves original ID)
export function restoreObject(boardId: string, obj: BoardObject) {
  const objectRef = ref(db, `boards/${boardId}/objects/${obj.id}`);
  return set(objectRef, { ...obj, updatedAt: Date.now() });
}

// ─── Connectors ───────────────────────────────────────────────

export function createConnector(boardId: string, conn: Omit<Connector, "id">): string {
  const connectorsRef = ref(db, `boards/${boardId}/connectors`);
  const newRef = push(connectorsRef);
  const id = newRef.key!;
  set(newRef, { ...conn, id });
  return id;
}

// Restore a previously deleted connector (preserves original ID)
export function restoreConnector(boardId: string, conn: Connector) {
  const connectorRef = ref(db, `boards/${boardId}/connectors/${conn.id}`);
  return set(connectorRef, conn);
}

export function deleteConnector(boardId: string, connectorId: string) {
  return remove(ref(db, `boards/${boardId}/connectors/${connectorId}`));
}

// ─── Real-time Listeners ──────────────────────────────────────

export function subscribeToObjects(
  boardId: string,
  onAdd: (obj: BoardObject) => void,
  onChange: (obj: BoardObject) => void,
  onRemove: (id: string) => void
) {
  const objectsRef = ref(db, `boards/${boardId}/objects`);

  const unsubAdd = onChildAdded(objectsRef, (snapshot) => {
    const obj = snapshot.val() as BoardObject;
    if (obj) onAdd(obj);
  });

  const unsubChange = onChildChanged(objectsRef, (snapshot) => {
    const obj = snapshot.val() as BoardObject;
    if (obj) onChange(obj);
  });

  const unsubRemove = onChildRemoved(objectsRef, (snapshot) => {
    onRemove(snapshot.key!);
  });

  return () => {
    off(objectsRef);
    // Unsubscribe references kept for cleanup
    void unsubAdd;
    void unsubChange;
    void unsubRemove;
  };
}

export function subscribeToConnectors(
  boardId: string,
  onAdd: (conn: Connector) => void,
  onChange: (conn: Connector) => void,
  onRemove: (id: string) => void
) {
  const connectorsRef = ref(db, `boards/${boardId}/connectors`);

  onChildAdded(connectorsRef, (snapshot) => {
    const conn = snapshot.val() as Connector;
    if (conn) onAdd(conn);
  });

  onChildChanged(connectorsRef, (snapshot) => {
    const conn = snapshot.val() as Connector;
    if (conn) onChange(conn);
  });

  onChildRemoved(connectorsRef, (snapshot) => {
    onRemove(snapshot.key!);
  });

  return () => {
    off(connectorsRef);
  };
}
