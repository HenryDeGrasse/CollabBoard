import {
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  serverTimestamp,
  off,
} from "firebase/database";
import { db } from "./firebase";
import type { UserPresence, CursorPosition } from "../types/presence";

export function setUserPresence(
  boardId: string,
  userId: string,
  displayName: string,
  cursorColor: string
) {
  const presenceRef = ref(db, `presence/${boardId}/${userId}`);
  const presence: UserPresence = {
    displayName,
    cursorColor,
    cursor: null,
    online: true,
    lastSeen: Date.now(),
    editingObjectId: null,
  };

  set(presenceRef, presence);

  // Register onDisconnect handlers
  const disconnectRef = onDisconnect(presenceRef);
  disconnectRef.update({
    online: false,
    cursor: null,
    editingObjectId: null,
    lastSeen: serverTimestamp(),
  });

  return presenceRef;
}

export function updateCursorPosition(
  boardId: string,
  userId: string,
  cursor: CursorPosition
) {
  const cursorRef = ref(db, `presence/${boardId}/${userId}/cursor`);
  return set(cursorRef, cursor);
}

export function setEditingObject(
  boardId: string,
  userId: string,
  objectId: string | null
) {
  const editRef = ref(db, `presence/${boardId}/${userId}/editingObjectId`);
  return set(editRef, objectId);
}

export function updateLastSeen(boardId: string, userId: string) {
  const lastSeenRef = ref(db, `presence/${boardId}/${userId}/lastSeen`);
  return set(lastSeenRef, serverTimestamp());
}

export function setOffline(boardId: string, userId: string) {
  const presenceRef = ref(db, `presence/${boardId}/${userId}`);
  return update(presenceRef, {
    online: false,
    cursor: null,
    editingObjectId: null,
  });
}

export function subscribeToPresence(
  boardId: string,
  callback: (users: Record<string, UserPresence>) => void
) {
  const presenceRef = ref(db, `presence/${boardId}`);

  const unsub = onValue(presenceRef, (snapshot) => {
    const val = snapshot.val() as Record<string, UserPresence> | null;
    callback(val || {});
  });

  return () => {
    off(presenceRef);
    void unsub;
  };
}

export function subscribeToConnectionState(callback: (connected: boolean) => void) {
  const connectedRef = ref(db, ".info/connected");
  onValue(connectedRef, (snapshot) => {
    callback(snapshot.val() === true);
  });
}
