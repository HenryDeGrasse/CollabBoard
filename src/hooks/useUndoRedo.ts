import { useState, useCallback, useRef } from "react";
import type { BoardObject, Connector } from "../types/board";

const MAX_UNDO_DEPTH = 30;

export type UndoAction =
  | { type: "create_object"; objectId: string; object: BoardObject }
  | { type: "delete_object"; objectId: string; object: BoardObject }
  | { type: "update_object"; objectId: string; before: Partial<BoardObject>; after: Partial<BoardObject> }
  | { type: "create_connector"; connectorId: string; connector: Connector }
  | { type: "delete_connector"; connectorId: string; connector: Connector }
  | { type: "batch"; actions: UndoAction[] };

export interface UseUndoRedoReturn {
  pushAction: (action: UndoAction) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedo(
  createObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string,
  updateObject: (id: string, updates: Partial<BoardObject>) => void,
  deleteObject: (id: string) => void,
  createConnector: (conn: Omit<Connector, "id">) => string,
  deleteConnector: (id: string) => void,
  // For re-creating deleted objects with their original ID
  restoreObject: (obj: BoardObject) => void,
  restoreConnector: (conn: Connector) => void,
): UseUndoRedoReturn {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  // Ref to prevent undo/redo actions from being pushed onto the stack
  const isUndoRedoRef = useRef(false);

  const pushAction = useCallback((action: UndoAction) => {
    if (isUndoRedoRef.current) return;
    setUndoStack((prev) => {
      const next = [...prev, action];
      if (next.length > MAX_UNDO_DEPTH) next.shift();
      return next;
    });
    setRedoStack([]); // Clear redo on new action
  }, []);

  const executeUndo = useCallback((action: UndoAction) => {
    switch (action.type) {
      case "create_object":
        deleteObject(action.objectId);
        break;
      case "delete_object":
        restoreObject(action.object);
        break;
      case "update_object":
        updateObject(action.objectId, action.before);
        break;
      case "create_connector":
        deleteConnector(action.connectorId);
        break;
      case "delete_connector":
        restoreConnector(action.connector);
        break;
      case "batch":
        // Undo in reverse order
        [...action.actions].reverse().forEach(executeUndo);
        break;
    }
  }, [deleteObject, restoreObject, updateObject, deleteConnector, restoreConnector]);

  const executeRedo = useCallback((action: UndoAction) => {
    switch (action.type) {
      case "create_object":
        restoreObject(action.object);
        break;
      case "delete_object":
        deleteObject(action.objectId);
        break;
      case "update_object":
        updateObject(action.objectId, action.after);
        break;
      case "create_connector":
        restoreConnector(action.connector);
        break;
      case "delete_connector":
        deleteConnector(action.connectorId);
        break;
      case "batch":
        action.actions.forEach(executeRedo);
        break;
    }
  }, [deleteObject, restoreObject, updateObject, deleteConnector, restoreConnector]);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      isUndoRedoRef.current = true;
      executeUndo(action);
      isUndoRedoRef.current = false;
      setRedoStack((r) => [...r, action]);
      return next;
    });
  }, [executeUndo]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      isUndoRedoRef.current = true;
      executeRedo(action);
      isUndoRedoRef.current = false;
      setUndoStack((u) => [...u, action]);
      return next;
    });
  }, [executeRedo]);

  return {
    pushAction,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
