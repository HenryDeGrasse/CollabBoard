import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { UserPresence } from "../types/presence";
import {
  setUserPresence,
  updateCursorPosition,
  setEditingObject as setEditingObj,
  setDraftText as setDraftTextService,
  updateLastSeen,
  setOffline,
  subscribeToPresence,
  subscribeToConnectionState,
} from "../services/presence";
import { throttle } from "../utils/throttle";
import { getRandomCursorColor } from "../utils/colors";

export interface UsePresenceReturn {
  users: Record<string, UserPresence>;
  updateCursor: (x: number, y: number) => void;
  setEditingObject: (objectId: string | null) => void;
  setDraftText: (text: string) => void;
  isObjectLocked: (objectId: string) => { locked: boolean; lockedBy?: string; lockedByColor?: string };
  getDraftTextForObject: (objectId: string) => { text: string; userName: string } | null;
  myColor: string;
}

export function usePresence(
  boardId: string,
  userId: string,
  displayName: string
): UsePresenceReturn {
  const [users, setUsers] = useState<Record<string, UserPresence>>({});
  const subscribedRef = useRef(false);
  const lastSeenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const colorRef = useRef<string>("");

  // Assign a cursor color based on userId
  useEffect(() => {
    if (!colorRef.current && userId) {
      const colorIndex = Math.abs(userId.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
      colorRef.current = getRandomCursorColor(colorIndex);
    }
  }, [userId]);

  useEffect(() => {
    if (subscribedRef.current || !boardId || !userId) return;
    subscribedRef.current = true;

    // Set initial presence
    setUserPresence(boardId, userId, displayName, colorRef.current);

    // Subscribe to all presence
    const unsubPresence = subscribeToPresence(boardId, (presenceData) => {
      setUsers(presenceData);
    });

    // Listen for reconnection
    subscribeToConnectionState((connected) => {
      if (connected) {
        setUserPresence(boardId, userId, displayName, colorRef.current);
      }
    });

    // Update lastSeen every 60 seconds
    lastSeenIntervalRef.current = setInterval(() => {
      updateLastSeen(boardId, userId);
    }, 60000);

    return () => {
      unsubPresence();
      setOffline(boardId, userId);
      if (lastSeenIntervalRef.current) {
        clearInterval(lastSeenIntervalRef.current);
      }
      subscribedRef.current = false;
    };
  }, [boardId, userId, displayName]);

  // Throttled cursor update (40ms = ~25 updates/sec)
  const throttledCursorUpdate = useMemo(
    () =>
      throttle((x: number, y: number) => {
        updateCursorPosition(boardId, userId, { x, y });
      }, 40),
    [boardId, userId]
  );

  const updateCursor = useCallback(
    (x: number, y: number) => {
      throttledCursorUpdate(x, y);
    },
    [throttledCursorUpdate]
  );

  const setEditingObject = useCallback(
    (objectId: string | null) => {
      setEditingObj(boardId, userId, objectId);
    },
    [boardId, userId]
  );

  const isObjectLocked = useCallback(
    (objectId: string) => {
      for (const [uid, presence] of Object.entries(users)) {
        if (uid !== userId && presence.editingObjectId === objectId && presence.online) {
          return {
            locked: true,
            lockedBy: presence.displayName,
            lockedByColor: presence.cursorColor,
          };
        }
      }
      return { locked: false };
    },
    [users, userId]
  );

  // Throttled draft text broadcast (every 2 seconds)
  const throttledDraftText = useMemo(
    () =>
      throttle((text: string) => {
        setDraftTextService(boardId, userId, text);
      }, 2000),
    [boardId, userId]
  );

  const setDraftText = useCallback(
    (text: string) => {
      throttledDraftText(text);
    },
    [throttledDraftText]
  );

  const getDraftTextForObject = useCallback(
    (objectId: string): { text: string; userName: string } | null => {
      for (const [uid, presence] of Object.entries(users)) {
        if (uid !== userId && presence.editingObjectId === objectId && presence.online && presence.draftText) {
          return { text: presence.draftText, userName: presence.displayName };
        }
      }
      return null;
    },
    [users, userId]
  );

  return {
    users,
    updateCursor,
    setEditingObject,
    setDraftText,
    isObjectLocked,
    getDraftTextForObject,
    myColor: colorRef.current,
  };
}
