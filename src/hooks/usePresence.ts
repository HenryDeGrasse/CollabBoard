import { useEffect, useState, useCallback, useRef } from "react";
import { createPresenceChannel, getNextCursorColor, type PresenceState } from "../services/presence";
import { throttle, type ThrottledFunction } from "../utils/throttle";

export interface RemoteUser {
  id: string;
  displayName: string;
  cursorColor: string;
  cursor: { x: number; y: number } | null;
  online: boolean;
  lastSeen: number;
  editingObjectId: string | null;
  draftText?: string;
}

export interface RemoteDragPosition {
  objectId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  parentFrameId?: string | null;
  userId: string;
  updatedAt: number;
}

/** Lightweight cursor-only store that lives outside React state.
 *  Components subscribe to get notified when cursor positions change
 *  without triggering Board-level re-renders. */
export interface CursorStore {
  /** Current cursor positions keyed by user ID */
  get: () => Record<string, { x: number; y: number }>;
  /** Subscribe to cursor changes — returns unsubscribe function */
  subscribe: (listener: () => void) => () => void;
}

export interface UsePresenceReturn {
  users: Record<string, RemoteUser>;
  cursorStore: CursorStore;
  remoteDragPositions: Record<string, RemoteDragPosition>;
  updateCursor: (x: number, y: number) => void;
  setEditingObject: (objectId: string | null) => void;
  setDraftText: (objectId: string, text: string) => void;
  broadcastObjectDrag: (
    objectId: string,
    x: number,
    y: number,
    parentFrameId?: string | null,
    width?: number,
    height?: number
  ) => void;
  endObjectDrag: (objectId: string) => void;
  isObjectLocked: (objectId: string) => {
    locked: boolean;
    lockedBy?: string;
    lockedByColor?: string;
  };
  getDraftTextForObject: (objectId: string) => { text: string; color: string } | null;
  myColor: string;
}

export function usePresence(
  boardId: string,
  userId: string,
  displayName: string
): UsePresenceReturn {
  const [users, setUsers] = useState<Record<string, RemoteUser>>({});
  const [remoteDragPositions, setRemoteDragPositions] = useState<Record<string, RemoteDragPosition>>({});
  const channelRef = useRef<ReturnType<typeof createPresenceChannel> | null>(null);
  const colorRef = useRef(getNextCursorColor());

  // ── Cursor store: ref-based, outside React state ──
  // Cursor positions update at ~30ms intervals per collaborator. By keeping
  // them out of React state we avoid triggering Board re-renders on every
  // cursor broadcast. Only the cursor rendering component subscribes.
  const cursorPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const cursorListenersRef = useRef<Set<() => void>>(new Set());
  const cursorStore = useRef<CursorStore>({
    get: () => cursorPositionsRef.current,
    subscribe: (listener: () => void) => {
      cursorListenersRef.current.add(listener);
      return () => { cursorListenersRef.current.delete(listener); };
    },
  }).current;
  const notifyCursorListeners = useCallback(() => {
    for (const listener of cursorListenersRef.current) listener();
  }, []);
  // Pending timeouts that delay clearing remoteDragPositions after drag_end.
  // Gives Supabase Realtime time to deliver the DB write before we remove
  // the drag preview, preventing a snap-back flicker on the collaborator's screen.
  const pendingDragClearsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dragBroadcastersRef = useRef<
    Record<
      string,
      ThrottledFunction<
        (
          x: number,
          y: number,
          parentFrameId?: string | null,
          width?: number,
          height?: number
        ) => void
      >
    >
  >({});

  useEffect(() => {
    if (!boardId || !userId) return;

    setRemoteDragPositions({});

    const channel = createPresenceChannel(
      boardId,
      userId,
      displayName,
      colorRef.current,
      (state) => {
        // Seed cursor store from presence state for users who have cursors
        const newCursors = { ...cursorPositionsRef.current };
        let cursorsChanged = false;

        // Clean up departed users from cursor store
        const aliveKeys = new Set(Object.keys(state));
        for (const key of Object.keys(newCursors)) {
          if (!aliveKeys.has(key)) {
            delete newCursors[key];
            cursorsChanged = true;
          }
        }

        for (const [key, presences] of Object.entries(state)) {
          const p = presences[0] as PresenceState;
          if (p?.cursor && !newCursors[key]) {
            newCursors[key] = { x: p.cursor.x, y: p.cursor.y };
            cursorsChanged = true;
          }
        }

        if (cursorsChanged) {
          cursorPositionsRef.current = newCursors;
          notifyCursorListeners();
        }

        setUsers((prev) => {
          const now = Date.now();
          const next: Record<string, RemoteUser> = {};

          for (const [key, presences] of Object.entries(state)) {
            const p = presences[0] as PresenceState;
            if (!p) continue;

            next[key] = {
              id: key,
              displayName: p.displayName,
              cursorColor: p.cursorColor,
              // Cursor positions are now tracked in cursorStore, keep null here
              cursor: null,
              online: true,
              lastSeen: now,
              editingObjectId: p.editingObjectId,
              draftText: p.draftText,
            };
          }

          return next;
        });
      },
      (remoteUserId, x, y) => {
        // Update the ref-based cursor store — does NOT trigger React re-renders.
        // Only the subscribed cursor rendering component will be notified.
        cursorPositionsRef.current = {
          ...cursorPositionsRef.current,
          [remoteUserId]: { x, y },
        };
        notifyCursorListeners();
      },
      (remoteUserId, objectId, position, parentFrameId, ended, width, height) => {
        if (ended) {
          // Don't clear immediately — give Supabase Realtime ~300 ms to deliver
          // the DB write. Without this delay the object snaps back to its
          // pre-drag position briefly before the Realtime update arrives.
          // Cancel any previously scheduled clear (e.g. double drag_end).
          if (pendingDragClearsRef.current[objectId]) {
            clearTimeout(pendingDragClearsRef.current[objectId]);
          }
          pendingDragClearsRef.current[objectId] = setTimeout(() => {
            delete pendingDragClearsRef.current[objectId];
            setRemoteDragPositions((prev) => {
              if (!prev[objectId]) return prev;
              const next = { ...prev };
              delete next[objectId];
              return next;
            });
          }, 300);
          return;
        }

        // New drag position arriving — cancel any pending clear for this object
        // (user might have picked it up again immediately after dropping).
        if (pendingDragClearsRef.current[objectId]) {
          clearTimeout(pendingDragClearsRef.current[objectId]);
          delete pendingDragClearsRef.current[objectId];
        }

        setRemoteDragPositions((prev) => ({
          ...prev,
          [objectId]: {
            objectId,
            x: position.x,
            y: position.y,
            ...(typeof width === "number" ? { width } : {}),
            ...(typeof height === "number" ? { height } : {}),
            parentFrameId,
            userId: remoteUserId,
            updatedAt: Date.now(),
          },
        }));
      }
    );

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      Object.values(dragBroadcastersRef.current).forEach((sender) => sender.cancel());
      dragBroadcastersRef.current = {};
      Object.values(pendingDragClearsRef.current).forEach(clearTimeout);
      pendingDragClearsRef.current = {};
      setRemoteDragPositions({});
    };
  }, [boardId, userId, displayName]);

  // Clean up stale remote drag previews (e.g. disconnect without drag_end).
  // Timeout is generous (6 s) because a heartbeat keeps active drags alive;
  // this only fires for genuine disconnects / crashes.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRemoteDragPositions((prev) => {
        let changed = false;
        const next: Record<string, RemoteDragPosition> = {};
        for (const [id, pos] of Object.entries(prev)) {
          if (now - pos.updatedAt <= 6000) {
            next[id] = pos;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Throttled cursor update (target: 30-50ms)
  const updateCursor = useCallback(
    throttle((x: number, y: number) => {
      channelRef.current?.updateCursor(x, y);
    }, 30),
    []
  );

  const setEditingObject = useCallback(
    (objectId: string | null) => {
      channelRef.current?.setEditingObject(objectId);
    },
    []
  );

  const setDraftText = useCallback(
    throttle((objectId: string, text: string) => {
      channelRef.current?.setDraftText(objectId, text);
    }, 250),
    []
  );

  const getDragBroadcaster = useCallback((objectId: string) => {
    let sender = dragBroadcastersRef.current[objectId];
    if (!sender) {
      sender = throttle(
        (
          x: number,
          y: number,
          parentFrameId?: string | null,
          width?: number,
          height?: number
        ) => {
          channelRef.current?.updateObjectDrag(objectId, x, y, parentFrameId, width, height);
        },
        30
      );
      dragBroadcastersRef.current[objectId] = sender;
    }
    return sender;
  }, []);

  const broadcastObjectDrag = useCallback(
    (
      objectId: string,
      x: number,
      y: number,
      parentFrameId?: string | null,
      width?: number,
      height?: number
    ) => {
      const sender = getDragBroadcaster(objectId);
      sender(x, y, parentFrameId, width, height);
    },
    [getDragBroadcaster]
  );

  const endObjectDrag = useCallback((objectId: string) => {
    const sender = dragBroadcastersRef.current[objectId];
    if (sender) {
      // Flush any pending trailing call first so the final position reaches
      // collaborators before the drag_end signal clears their preview.
      sender.flush();
      sender.cancel();
      delete dragBroadcastersRef.current[objectId];
    }
    channelRef.current?.endObjectDrag(objectId);
  }, []);

  const isObjectLocked = useCallback(
    (objectId: string) => {
      for (const [uid, user] of Object.entries(users)) {
        if (uid !== userId && user.editingObjectId === objectId) {
          return {
            locked: true,
            lockedBy: user.displayName,
            lockedByColor: user.cursorColor,
          };
        }
      }
      return { locked: false };
    },
    [users, userId]
  );

  const getDraftTextForObject = useCallback(
    (objectId: string) => {
      for (const [uid, user] of Object.entries(users)) {
        if (uid !== userId && user.editingObjectId === objectId && user.draftText) {
          return { text: user.draftText, color: user.cursorColor };
        }
      }
      return null;
    },
    [users, userId]
  );

  return {
    users,
    cursorStore,
    remoteDragPositions,
    updateCursor,
    setEditingObject,
    setDraftText,
    broadcastObjectDrag,
    endObjectDrag,
    isObjectLocked,
    getDraftTextForObject,
    myColor: colorRef.current,
  };
}
