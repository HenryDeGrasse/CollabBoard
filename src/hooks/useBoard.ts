import { useEffect, useState, useCallback, useRef } from "react";
import type { BoardObject, Connector } from "../types/board";
import * as boardService from "../services/board";
import { createBoardRealtimeChannels } from "../services/presence";
import { supabase } from "../services/supabase";

// DB row → BoardObject mapping
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

function dbToConnector(row: any): Connector {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    style: row.style,
  };
}

export interface UseBoardReturn {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  boardTitle: string;
  updateBoardTitle: (title: string) => void;
  createObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  deleteObject: (id: string) => void;
  deleteFrameCascade: (frameId: string) => void;
  createConnector: (conn: Omit<Connector, "id">) => string;
  deleteConnector: (id: string) => void;
  restoreObject: (obj: BoardObject) => void;
  restoreObjects: (objs: BoardObject[]) => void;
  restoreConnector: (conn: Connector) => void;
  loading: boolean;
}

const UPDATE_FLUSH_MS = 40;

export function useBoard(boardId: string): UseBoardReturn {
  const [objects, setObjects] = useState<Record<string, BoardObject>>({});
  const [connectors, setConnectors] = useState<Record<string, Connector>>({});
  const [boardTitle, setBoardTitle] = useState("Untitled Board");
  const [loading, setLoading] = useState(true);
  const subscribedRef = useRef(false);
  const pendingObjectUpdatesRef = useRef<Record<string, Partial<BoardObject>>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingObjectUpdates = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const pending = pendingObjectUpdatesRef.current;
    pendingObjectUpdatesRef.current = {};

    Object.entries(pending).forEach(([id, updates]) => {
      boardService.updateObject(boardId, id, updates).catch((err) => {
        console.error("Failed to update object:", err);
      });
    });
  }, [boardId]);

  const scheduleObjectUpdateFlush = useCallback(() => {
    if (flushTimerRef.current) return;

    flushTimerRef.current = setTimeout(() => {
      flushPendingObjectUpdates();
    }, UPDATE_FLUSH_MS);
  }, [flushPendingObjectUpdates]);

  // Initial fetch + realtime subscription.
  // boardId is empty until joinBoard() completes (prevents RLS-blocked empty fetches).
  useEffect(() => {
    if (!boardId || subscribedRef.current) return;
    subscribedRef.current = true;

    let channels: ReturnType<typeof createBoardRealtimeChannels> | null = null;

    async function init() {
      try {
        // Fetch initial data + board metadata
        const [objs, conns, meta] = await Promise.all([
          boardService.fetchBoardObjects(boardId),
          boardService.fetchBoardConnectors(boardId),
          boardService.fetchBoardMetadata(boardId),
        ]);
        setObjects(objs);
        setConnectors(conns);
        if (meta?.title) setBoardTitle(meta.title);
      } catch (err) {
        console.error("Failed to load board:", err);
      } finally {
        setLoading(false);
      }

      // Subscribe to realtime changes (separate channels per table)
      channels = createBoardRealtimeChannels(
        boardId,
        // Object changes
        (eventType, row) => {
          if (eventType === "INSERT" || eventType === "UPDATE") {
            const obj = dbToObject(row);
            setObjects((prev) => {
              // If we have unflushed local changes, keep optimistic position/size to
              // avoid flicker from slightly stale realtime echoes.
              if (pendingObjectUpdatesRef.current[obj.id]) {
                return prev;
              }

              const existing = prev[obj.id];
              // Ignore out-of-order older updates.
              if (existing && existing.updatedAt > obj.updatedAt) {
                return prev;
              }

              return { ...prev, [obj.id]: obj };
            });
          } else if (eventType === "DELETE") {
            const id = row.id;
            // Clear pending updates for deleted objects
            delete pendingObjectUpdatesRef.current[id];
            setObjects((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
        },
        // Connector changes
        (eventType, row) => {
          if (eventType === "INSERT" || eventType === "UPDATE") {
            const conn = dbToConnector(row);
            setConnectors((prev) => ({ ...prev, [conn.id]: conn }));
          } else if (eventType === "DELETE") {
            const id = row.id;
            setConnectors((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
        }
      );
    }

    init();

    return () => {
      subscribedRef.current = false;
      flushPendingObjectUpdates();
      if (channels) {
        channels.forEach((ch) => supabase.removeChannel(ch));
      }
    };
  }, [boardId, flushPendingObjectUpdates]);

  // Optimistic create — generates a temporary local ID, writes to DB,
  // then realtime subscription will update with the real DB row.
  const createObject = useCallback(
    (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">): string => {
      const tempId = crypto.randomUUID();
      const now = Date.now();
      const fullObj: BoardObject = {
        ...obj,
        id: tempId,
        createdAt: now,
        updatedAt: now,
      };

      // Optimistic local update
      setObjects((prev) => ({ ...prev, [tempId]: fullObj }));

      // Write to DB (async, realtime will confirm)
      boardService.createObject(boardId, obj).then((realId) => {
        // Replace temp ID with real ID
        setObjects((prev) => {
          const next = { ...prev };
          delete next[tempId];
          // The realtime subscription will add the real object
          // but we pre-set it here to avoid flicker
          next[realId] = { ...fullObj, id: realId };
          return next;
        });
      }).catch((err) => {
        console.error("Failed to create object:", err);
        // Rollback optimistic update
        setObjects((prev) => {
          const next = { ...prev };
          delete next[tempId];
          return next;
        });
      });

      return tempId;
    },
    [boardId]
  );

  const updateObject = useCallback(
    (id: string, updates: Partial<BoardObject>) => {
      // Optimistic local update
      setObjects((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates, updatedAt: Date.now() } };
      });

      // Coalesce rapid updates (drag/resize) before writing to DB.
      pendingObjectUpdatesRef.current[id] = {
        ...(pendingObjectUpdatesRef.current[id] || {}),
        ...updates,
      };
      scheduleObjectUpdateFlush();
    },
    [scheduleObjectUpdateFlush]
  );

  const deleteObject = useCallback(
    (id: string) => {
      // Optimistic local removal
      setObjects((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      // If there was a pending coalesced update, drop it.
      delete pendingObjectUpdatesRef.current[id];

      boardService.deleteObject(boardId, id).catch((err) => {
        console.error("Failed to delete object:", err);
      });
    },
    [boardId]
  );

  const deleteFrameCascade = useCallback(
    (frameId: string) => {
      const idsToDelete = new Set(
        Object.values(objects)
          .filter((obj) => obj.id === frameId || obj.parentFrameId === frameId)
          .map((obj) => obj.id)
      );

      // Optimistically remove frame + contained objects from local state.
      setObjects((prev) => {
        const next = { ...prev };
        idsToDelete.forEach((id) => {
          delete next[id];
        });
        return next;
      });

      // Drop any pending coalesced writes for deleted ids.
      idsToDelete.forEach((id) => {
        delete pendingObjectUpdatesRef.current[id];
      });

      // Optimistically remove connectors attached to deleted objects.
      if (idsToDelete.size > 0) {
        setConnectors((prev) => {
          const next = { ...prev };
          Object.values(prev).forEach((conn) => {
            if (idsToDelete.has(conn.fromId) || idsToDelete.has(conn.toId)) {
              delete next[conn.id];
            }
          });
          return next;
        });
      }

      boardService.deleteFrameCascade(boardId, frameId).catch((err) => {
        console.error("Failed to delete frame cascade:", err);
      });
    },
    [boardId, objects]
  );

  const createConnector = useCallback(
    (conn: Omit<Connector, "id">): string => {
      const tempId = crypto.randomUUID();
      const fullConn: Connector = { ...conn, id: tempId };

      setConnectors((prev) => ({ ...prev, [tempId]: fullConn }));

      boardService.createConnector(boardId, conn).then((realId) => {
        setConnectors((prev) => {
          const next = { ...prev };
          delete next[tempId];
          next[realId] = { ...fullConn, id: realId };
          return next;
        });
      }).catch((err) => {
        console.error("Failed to create connector:", err);
        setConnectors((prev) => {
          const next = { ...prev };
          delete next[tempId];
          return next;
        });
      });

      return tempId;
    },
    [boardId]
  );

  const deleteConnector = useCallback(
    (id: string) => {
      setConnectors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      boardService.deleteConnector(boardId, id).catch((err) => {
        console.error("Failed to delete connector:", err);
      });
    },
    [boardId]
  );

  const updateBoardTitle = useCallback(
    (title: string) => {
      setBoardTitle(title);
      boardService.updateBoardMetadata(boardId, { title }).catch(console.error);
    },
    [boardId]
  );

  const restoreObject = useCallback(
    (obj: BoardObject) => {
      setObjects((prev) => ({ ...prev, [obj.id]: obj }));
      boardService.restoreObject(boardId, obj).catch(console.error);
    },
    [boardId]
  );

  // Track the latest batch-restore promise so connector restores can wait for
  // their endpoint objects to exist in the DB before inserting.
  const restorePromiseRef = useRef<Promise<void>>(Promise.resolve());

  const restoreObjects = useCallback(
    (objs: BoardObject[]) => {
      // Optimistic: add all to local state immediately
      setObjects((prev) => {
        const next = { ...prev };
        for (const obj of objs) {
          next[obj.id] = obj;
        }
        return next;
      });
      // Persist in FK-safe order (frames before children)
      restorePromiseRef.current = boardService
        .restoreObjects(boardId, objs)
        .catch(console.error)
        .then(() => {});
    },
    [boardId]
  );

  const restoreConnector = useCallback(
    (conn: Connector) => {
      setConnectors((prev) => ({ ...prev, [conn.id]: conn }));
      // Wait for any pending object restores to complete (FK: connector endpoints must exist)
      restorePromiseRef.current
        .then(() => boardService.restoreConnector(boardId, conn))
        .catch(console.error);
    },
    [boardId]
  );

  return {
    objects,
    connectors,
    boardTitle,
    updateBoardTitle,
    createObject,
    updateObject,
    deleteObject,
    deleteFrameCascade,
    createConnector,
    deleteConnector,
    restoreObject,
    restoreObjects,
    restoreConnector,
    loading,
  };
}
