import {
  ref,
  push,
  set,
  update,
  remove,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  serverTimestamp,
  get,
  off,
} from "firebase/database";
import { db } from "./firebase";
import type { BoardObject, Connector, BoardMetadata } from "../types/board";

// ─── Board Metadata ───────────────────────────────────────────

export function createBoard(boardId: string, title: string, ownerId: string) {
  const metadata: BoardMetadata = {
    title,
    createdAt: Date.now(),
    ownerId,
  };
  return set(ref(db, `boards/${boardId}/metadata`), metadata);
}

export async function getBoardMetadata(boardId: string): Promise<BoardMetadata | null> {
  const snapshot = await get(ref(db, `boards/${boardId}/metadata`));
  return snapshot.val();
}

// ─── Board Objects ────────────────────────────────────────────

export function createObject(boardId: string, obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">): string {
  const objectsRef = ref(db, `boards/${boardId}/objects`);
  const newRef = push(objectsRef);
  const id = newRef.key!;
  const fullObj: BoardObject = {
    ...obj,
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
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

// ─── Connectors ───────────────────────────────────────────────

export function createConnector(boardId: string, conn: Omit<Connector, "id">): string {
  const connectorsRef = ref(db, `boards/${boardId}/connectors`);
  const newRef = push(connectorsRef);
  const id = newRef.key!;
  set(newRef, { ...conn, id });
  return id;
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
