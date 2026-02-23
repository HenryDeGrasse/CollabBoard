import { useEffect, useState, useCallback, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { BoardObject, Connector } from "../types/board";
import * as boardService from "../services/board-crud";
import { dbToObject, dbToConnector } from "../services/board-types";
import { createBoardRealtimeChannels } from "../services/presence";
import { supabase } from "../services/supabase";
import { OBJECT_UPDATE_FLUSH_MS } from "../constants";

export type IdRemapCallback = (tempId: string, realId: string) => void;

/** Callback invoked when a persistence operation fails, allowing the UI to
 *  display a toast or notification instead of silently swallowing errors. */
export type PersistenceErrorCallback = (message: string) => void;

export interface UseBoardReturn {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  boardTitle: string;
  updateBoardTitle: (title: string) => void;
  createObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  /** Batch-insert multiple objects in a single DB round-trip (chunked at 200). */
  createObjects: (objs: Omit<BoardObject, "id" | "createdAt" | "updatedAt">[]) => Promise<string[]>;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  deleteObject: (id: string) => void;
  deleteFrameCascade: (frameId: string) => void;
  createConnector: (conn: Omit<Connector, "id">) => string;
  updateConnector: (id: string, updates: Partial<Pick<Connector, "color" | "strokeWidth">>) => void;
  deleteConnector: (id: string) => void;
  restoreObject: (obj: BoardObject) => void;
  restoreObjects: (objs: BoardObject[]) => void;
  restoreConnector: (conn: Connector) => void;
  /** Register a callback invoked when a temp ID from createObject is replaced by the real DB ID */
  setIdRemapCallback: (cb: IdRemapCallback | null) => void;
  /** Register a callback for persistence errors (e.g. to show a toast) */
  setPersistenceErrorCallback: (cb: PersistenceErrorCallback | null) => void;
  loading: boolean;
}

export function useBoard(boardId: string): UseBoardReturn {
  const [objects, setObjects] = useState<Record<string, BoardObject>>({});
  const [connectors, setConnectors] = useState<Record<string, Connector>>({});
  const [boardTitle, setBoardTitle] = useState("Untitled Board");
  const [loading, setLoading] = useState(true);
  const subscribedRef = useRef(false);
  const pendingObjectUpdatesRef = useRef<Record<string, Partial<BoardObject>>>({});
  const idRemapCallbackRef = useRef<IdRemapCallback | null>(null);
  const persistenceErrorCallbackRef = useRef<PersistenceErrorCallback | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushInFlightRef = useRef(false);
  const flushQueuedRef = useRef(false);

  /** Report a persistence error to the UI (if a callback is registered). */
  const reportPersistenceError = useCallback((message: string) => {
    console.error("[useBoard] Persistence error:", message);
    persistenceErrorCallbackRef.current?.(message);
  }, []);

  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  // ── rAF-batched Realtime event processing ─────────────────
  // Supabase Realtime delivers each event in a separate WebSocket message
  // callback (separate macro-task). Without batching, N events in quick
  // succession → N separate setObjects/setConnectors → N React renders,
  // each doing an O(objects) spread. By accumulating events in refs and
  // flushing once per animation frame we collapse the burst into a single
  // render + single O(objects) spread.
  const pendingRtObjectUpserts = useRef<Map<string, BoardObject>>(new Map());
  const pendingRtObjectDeletes = useRef<Set<string>>(new Set());
  const pendingRtConnUpserts = useRef<Map<string, Connector>>(new Map());
  const pendingRtConnDeletes = useRef<Set<string>>(new Set());
  const rtFlushRafRef = useRef<number | null>(null);

  const flushRealtimeEvents = useCallback(() => {
    rtFlushRafRef.current = null;

    // ── Object events ──
    const objUpserts = pendingRtObjectUpserts.current;
    const objDeletes = pendingRtObjectDeletes.current;

    if (objUpserts.size > 0 || objDeletes.size > 0) {
      pendingRtObjectUpserts.current = new Map();
      pendingRtObjectDeletes.current = new Set();

      setObjects((prev) => {
        let next: Record<string, BoardObject> | null = null;

        for (const [id, obj] of objUpserts) {
          // Keep optimistic local values while pending writes exist.
          if (pendingObjectUpdatesRef.current[id]) continue;
          const existing = (next ?? prev)[id];
          if (existing && existing.updatedAt > obj.updatedAt) continue;
          if (!next) next = { ...prev };
          next[id] = obj;
        }

        for (const id of objDeletes) {
          if (!(next ?? prev)[id]) continue;
          delete pendingObjectUpdatesRef.current[id];
          if (!next) next = { ...prev };
          delete next[id];
        }

        return next ?? prev;
      });
    }

    // ── Connector events ──
    const connUpserts = pendingRtConnUpserts.current;
    const connDeletes = pendingRtConnDeletes.current;

    if (connUpserts.size > 0 || connDeletes.size > 0) {
      pendingRtConnUpserts.current = new Map();
      pendingRtConnDeletes.current = new Set();

      setConnectors((prev) => {
        let next: Record<string, Connector> | null = null;

        for (const [id, conn] of connUpserts) {
          if (!next) next = { ...prev };
          next[id] = conn;
        }

        for (const id of connDeletes) {
          if (!(next ?? prev)[id]) continue;
          if (!next) next = { ...prev };
          delete next[id];
        }

        return next ?? prev;
      });
    }
  }, []);

  const scheduleRealtimeFlush = useCallback(() => {
    if (rtFlushRafRef.current !== null) return;
    rtFlushRafRef.current = requestAnimationFrame(flushRealtimeEvents);
  }, [flushRealtimeEvents]);

  const flushPendingObjectUpdates = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    if (flushInFlightRef.current) {
      // Backpressure: only keep one queued flush while a write is in flight.
      flushQueuedRef.current = true;
      return;
    }

    const pending = pendingObjectUpdatesRef.current;
    const pendingIds = Object.keys(pending);
    if (pendingIds.length === 0) return;

    pendingObjectUpdatesRef.current = {};

    const rowsToUpsert: BoardObject[] = [];
    for (const id of pendingIds) {
      const existing = objectsRef.current[id];
      if (!existing) continue;
      rowsToUpsert.push({ ...existing, ...pending[id], id });
    }

    if (rowsToUpsert.length === 0) return;

    flushInFlightRef.current = true;
    boardService
      .updateObjectsBulk(boardId, rowsToUpsert)
      .catch(() => {
        reportPersistenceError("Failed to save object changes. Retrying individually…");
        // Fallback to per-object updates so we preserve correctness if the
        // bulk path fails for any reason.
        pendingIds.forEach((id) => {
          const updates = pending[id];
          if (!updates) return;
          boardService.updateObject(boardId, id, updates).catch((innerErr) => {
            reportPersistenceError(`Failed to update object ${id}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
          });
        });
      })
      .finally(() => {
        flushInFlightRef.current = false;

        if (flushQueuedRef.current || Object.keys(pendingObjectUpdatesRef.current).length > 0) {
          flushQueuedRef.current = false;
          if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(() => {
              flushPendingObjectUpdates();
            }, OBJECT_UPDATE_FLUSH_MS);
          }
        }
      });
  }, [boardId, reportPersistenceError]);

  const scheduleObjectUpdateFlush = useCallback(() => {
    if (flushTimerRef.current) return;

    flushTimerRef.current = setTimeout(() => {
      flushPendingObjectUpdates();
    }, OBJECT_UPDATE_FLUSH_MS);
  }, [flushPendingObjectUpdates]);

  // Initial fetch + realtime subscription.
  // boardId is empty until joinBoard() completes (prevents RLS-blocked empty fetches).
  useEffect(() => {
    if (!boardId || subscribedRef.current) return;
    subscribedRef.current = true;

    let cancelled = false;
    const channelsRef: { current: RealtimeChannel[] } = { current: [] };

    async function init() {
      try {
        // Fetch initial data + board metadata
        const [objs, conns, meta] = await Promise.all([
          boardService.fetchBoardObjects(boardId),
          boardService.fetchBoardConnectors(boardId),
          boardService.fetchBoardMetadata(boardId),
        ]);
        if (cancelled) return;

        setObjects(objs);
        setConnectors(conns);
        if (meta?.title) setBoardTitle(meta.title);

        // Subscribe to realtime AFTER applying snapshot so we don't overwrite
        // realtime updates with stale data, and don't trigger React updates during loading.
        const channels = createBoardRealtimeChannels(
          boardId,
          // Object changes — accumulated and flushed once per animation frame
          (eventType, row) => {
            if (eventType === "INSERT" || eventType === "UPDATE") {
              const obj = dbToObject(row);
              pendingRtObjectUpserts.current.set(obj.id, obj);
              pendingRtObjectDeletes.current.delete(obj.id);
            } else if (eventType === "DELETE") {
              const id = row.id;
              pendingRtObjectDeletes.current.add(id);
              pendingRtObjectUpserts.current.delete(id);
            }
            scheduleRealtimeFlush();
          },
          // Connector changes — accumulated and flushed once per animation frame
          (eventType, row) => {
            if (eventType === "INSERT" || eventType === "UPDATE") {
              const conn = dbToConnector(row);
              pendingRtConnUpserts.current.set(conn.id, conn);
              pendingRtConnDeletes.current.delete(conn.id);
            } else if (eventType === "DELETE") {
              const id = row.id;
              pendingRtConnDeletes.current.add(id);
              pendingRtConnUpserts.current.delete(id);
            }
            scheduleRealtimeFlush();
          }
        );
        channelsRef.current = channels;
      } catch (err) {
        if (!cancelled) console.error("Failed to load board:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      subscribedRef.current = false;
      // Flush any pending batched Realtime events synchronously before teardown.
      if (rtFlushRafRef.current !== null) {
        cancelAnimationFrame(rtFlushRafRef.current);
        rtFlushRafRef.current = null;
      }
      flushRealtimeEvents();
      flushPendingObjectUpdates();
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [boardId, flushPendingObjectUpdates, flushRealtimeEvents]);

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
        // Notify listeners (e.g. selection) about the ID remap
        idRemapCallbackRef.current?.(tempId, realId);
      }).catch((err) => {
        reportPersistenceError(`Failed to create object: ${err instanceof Error ? err.message : String(err)}`);
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

  // Batch-create: optimistically adds all objects with temp IDs, then
  // fires a single batched DB insert (chunked at 200) and swaps real IDs in.
  const createObjects = useCallback(
    async (objs: Omit<BoardObject, "id" | "createdAt" | "updatedAt">[]): Promise<string[]> => {
      if (objs.length === 0) return [];

      const now = Date.now();
      const tempIds = objs.map(() => crypto.randomUUID());

      // Optimistic local updates
      setObjects((prev) => {
        const next = { ...prev };
        for (let i = 0; i < objs.length; i++) {
          const fullObj: BoardObject = { ...objs[i], id: tempIds[i], createdAt: now, updatedAt: now };
          next[tempIds[i]] = fullObj;
        }
        return next;
      });

      try {
        const realIds = await boardService.createObjects(boardId, objs);
        // Swap temp IDs for real DB IDs
        setObjects((prev) => {
          const next = { ...prev };
          for (let i = 0; i < tempIds.length; i++) {
            const tempId = tempIds[i];
            const realId = realIds[i];
            if (!realId) continue;
            const existing = next[tempId];
            if (existing) {
              delete next[tempId];
              next[realId] = { ...existing, id: realId };
              idRemapCallbackRef.current?.(tempId, realId);
            }
          }
          return next;
        });
        return realIds;
      } catch (err) {
        reportPersistenceError(`Failed to batch-create objects: ${err instanceof Error ? err.message : String(err)}`);
        // Rollback all optimistic updates
        setObjects((prev) => {
          const next = { ...prev };
          for (const tempId of tempIds) delete next[tempId];
          return next;
        });
        return [];
      }
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
        reportPersistenceError(`Failed to delete object: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [boardId]
  );

  const deleteFrameCascade = useCallback(
    (frameId: string) => {
      // Use the stable ref so this callback is never recreated on objects changes,
      // and so it always reads the latest state when invoked.
      const idsToDelete = new Set(
        Object.values(objectsRef.current)
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

      // Capture the objects being deleted so we can rollback on failure.
      const deletedObjects: BoardObject[] = [];
      for (const id of idsToDelete) {
        const obj = objectsRef.current[id];
        if (obj) deletedObjects.push({ ...obj });
      }

      boardService.deleteFrameCascade(boardId, frameId).catch((err) => {
        reportPersistenceError(`Failed to delete frame — restoring objects. ${err instanceof Error ? err.message : String(err)}`);
        // Rollback: re-add all optimistically deleted objects to local state.
        // A subsequent Realtime event will reconcile, but this prevents the
        // confusing intermediate state where objects are gone from the UI
        // but still exist in the DB.
        setObjects((prev) => {
          const next = { ...prev };
          for (const obj of deletedObjects) {
            next[obj.id] = obj;
          }
          return next;
        });
      });
    },
    // objectsRef.current is a stable ref — no need to list objects here.
    // reportPersistenceError is a stable useCallback with no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, reportPersistenceError]
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
        reportPersistenceError(`Failed to create connector: ${err instanceof Error ? err.message : String(err)}`);
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

  const updateConnector = useCallback(
    (id: string, updates: Partial<Pick<Connector, "color" | "strokeWidth">>) => {
      // Optimistic local update
      setConnectors((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, ...updates } };
      });

      boardService.updateConnector(boardId, id, updates).catch((err) => {
        reportPersistenceError(`Failed to update connector: ${err instanceof Error ? err.message : String(err)}`);
      });
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
        reportPersistenceError(`Failed to delete connector: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [boardId]
  );

  const updateBoardTitle = useCallback(
    (title: string) => {
      setBoardTitle(title);
      boardService.updateBoardMetadata(boardId, { title }).catch((err) => {
        reportPersistenceError(`Failed to update board title: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [boardId]
  );

  const restoreObject = useCallback(
    (obj: BoardObject) => {
      setObjects((prev) => ({ ...prev, [obj.id]: obj }));
      boardService.restoreObject(boardId, obj).catch((err) => {
        reportPersistenceError(`Failed to restore object: ${err instanceof Error ? err.message : String(err)}`);
      });
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
        .catch((err) => {
          reportPersistenceError(`Failed to restore objects: ${err instanceof Error ? err.message : String(err)}`);
        })
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
        .catch((err) => {
          reportPersistenceError(`Failed to restore connector: ${err instanceof Error ? err.message : String(err)}`);
        });
    },
    [boardId]
  );

  const setIdRemapCallback = useCallback((cb: IdRemapCallback | null) => {
    idRemapCallbackRef.current = cb;
  }, []);

  const setPersistenceErrorCallback = useCallback((cb: PersistenceErrorCallback | null) => {
    persistenceErrorCallbackRef.current = cb;
  }, []);

  return {
    objects,
    connectors,
    boardTitle,
    updateBoardTitle,
    createObject,
    createObjects,
    updateObject,
    deleteObject,
    deleteFrameCascade,
    createConnector,
    updateConnector,
    deleteConnector,
    restoreObject,
    restoreObjects,
    restoreConnector,
    setIdRemapCallback,
    setPersistenceErrorCallback,
    loading,
  };
}
