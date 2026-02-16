import { useState, useEffect, useRef, useCallback } from "react";
import type { BoardObject, Connector } from "../types/board";
import {
  subscribeToObjects,
  subscribeToConnectors,
  createObject as createObj,
  updateObject as updateObj,
  deleteObject as deleteObj,
  createConnector as createConn,
  deleteConnector as deleteConn,
} from "../services/board";

export interface UseBoardReturn {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  createObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  deleteObject: (id: string) => void;
  createConnector: (conn: Omit<Connector, "id">) => string;
  deleteConnector: (id: string) => void;
  loading: boolean;
}

export function useBoard(boardId: string): UseBoardReturn {
  const [objects, setObjects] = useState<Record<string, BoardObject>>({});
  const [connectors, setConnectors] = useState<Record<string, Connector>>({});
  const [loading, setLoading] = useState(true);
  const subscribedRef = useRef(false);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (subscribedRef.current || !boardId) return;
    subscribedRef.current = true;

    // Small delay to collect initial onChildAdded events
    const loadTimeout = setTimeout(() => {
      if (initialLoadRef.current) {
        setLoading(false);
        initialLoadRef.current = false;
      }
    }, 500);

    const unsubObjects = subscribeToObjects(
      boardId,
      (obj) => {
        setObjects((prev) => ({ ...prev, [obj.id]: obj }));
        if (initialLoadRef.current) {
          // Still in initial load
        }
      },
      (obj) => {
        setObjects((prev) => ({ ...prev, [obj.id]: obj }));
      },
      (id) => {
        setObjects((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    );

    const unsubConnectors = subscribeToConnectors(
      boardId,
      (conn) => {
        setConnectors((prev) => ({ ...prev, [conn.id]: conn }));
      },
      (conn) => {
        setConnectors((prev) => ({ ...prev, [conn.id]: conn }));
      },
      (id) => {
        setConnectors((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    );

    return () => {
      clearTimeout(loadTimeout);
      unsubObjects();
      unsubConnectors();
      subscribedRef.current = false;
    };
  }, [boardId]);

  const createObject = useCallback(
    (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => {
      return createObj(boardId, obj);
    },
    [boardId]
  );

  const updateObject = useCallback(
    (id: string, updates: Partial<BoardObject>) => {
      updateObj(boardId, id, updates);
    },
    [boardId]
  );

  const deleteObject = useCallback(
    (id: string) => {
      deleteObj(boardId, id);
    },
    [boardId]
  );

  const createConnector = useCallback(
    (conn: Omit<Connector, "id">) => {
      return createConn(boardId, conn);
    },
    [boardId]
  );

  const deleteConnector = useCallback(
    (id: string) => {
      deleteConn(boardId, id);
    },
    [boardId]
  );

  return {
    objects,
    connectors,
    createObject,
    updateObject,
    deleteObject,
    createConnector,
    deleteConnector,
    loading,
  };
}
