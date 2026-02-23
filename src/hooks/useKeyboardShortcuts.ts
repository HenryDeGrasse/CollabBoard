import { useEffect } from "react";
import type { BoardObject, Connector } from "../types/board";
import type { ToolType } from "../types/tool";
import type { UseCanvasReturn } from "./useCanvas";
import type { UseSelectionReturn } from "./useSelection";
import {
  isTextCapableObjectType,
  resolveObjectTextSize,
  clampTextSizeForType,
} from "../utils/text";

export interface UseKeyboardShortcutsParams {
  undoRedo: { undo: () => void; redo: () => void };
  createObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  createConnector: (conn: Omit<Connector, "id">) => string;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  userId: string;
  clipboardRef: React.MutableRefObject<{ objects: BoardObject[]; connectors: Connector[] }>;
  objectsRef: React.MutableRefObject<Record<string, BoardObject>>;
  connectorsRef: React.MutableRefObject<Record<string, Connector>>;
  selectionRef: React.MutableRefObject<UseSelectionReturn>;
  canvas: UseCanvasReturn;
  onToolChange: (tool: ToolType) => void;
}

/**
 * Keyboard shortcuts for tools, undo/redo, copy/paste/duplicate, and text size.
 * Manages its own window event listener lifecycle.
 */
export function useKeyboardShortcuts({
  undoRedo,
  createObject,
  createConnector,
  updateObject,
  userId,
  clipboardRef,
  objectsRef,
  connectorsRef,
  selectionRef,
  canvas,
  onToolChange,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      // Undo: Ctrl+Z
      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo();
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (ctrl && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        undoRedo.redo();
        return;
      }

      // Copy: Ctrl+C
      if (ctrl && e.key === "c") {
        e.preventDefault();
        const sel = selectionRef.current;
        const objs = objectsRef.current;
        const conns = connectorsRef.current;
        const selectedObjs = Array.from(sel.selectedIds)
          .map((id) => objs[id])
          .filter(Boolean);
        const selectedConns = Object.values(conns).filter(
          (c) => sel.selectedIds.has(c.fromId) && sel.selectedIds.has(c.toId)
        );
        clipboardRef.current = {
          objects: selectedObjs.map((o) => ({ ...o })),
          connectors: selectedConns.map((c) => ({ ...c })),
        };
        return;
      }

      // Paste: Ctrl+V
      if (ctrl && e.key === "v") {
        e.preventDefault();
        const sel = selectionRef.current;
        const { objects: clipObjs, connectors: clipConns } = clipboardRef.current;
        if (clipObjs.length === 0) return;

        // Compute offset to place pasted objects at the cursor position.
        const stage = canvas.stageRef.current;
        const pointer = stage?.getPointerPosition();
        let offsetX = 20;
        let offsetY = 20;
        if (pointer && stage) {
          const canvasPos = canvas.screenToCanvas(pointer.x, pointer.y);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const obj of clipObjs) {
            minX = Math.min(minX, obj.x);
            minY = Math.min(minY, obj.y);
            maxX = Math.max(maxX, obj.x + obj.width);
            maxY = Math.max(maxY, obj.y + obj.height);
          }
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          offsetX = canvasPos.x - centerX;
          offsetY = canvasPos.y - centerY;
        }

        const idMap: Record<string, string> = {};

        for (const obj of clipObjs) {
          const newId = createObject({
            type: obj.type,
            x: obj.x + offsetX,
            y: obj.y + offsetY,
            width: obj.width,
            height: obj.height,
            color: obj.color,
            text: obj.text,
            textSize: obj.textSize,
            textColor: obj.textColor,
            rotation: obj.rotation,
            zIndex: obj.zIndex,
            createdBy: userId,
            points: obj.points,
            strokeWidth: obj.strokeWidth,
          });
          idMap[obj.id] = newId;
        }

        for (const conn of clipConns) {
          const newFromId = idMap[conn.fromId];
          const newToId = idMap[conn.toId];
          if (newFromId && newToId) {
            createConnector({ fromId: newFromId, toId: newToId, style: conn.style });
          }
        }

        sel.selectMultiple(Object.values(idMap));

        // Update clipboard positions so cascaded pastes offset from cursor position
        clipboardRef.current = {
          objects: clipObjs.map((o) => ({ ...o, x: o.x + offsetX, y: o.y + offsetY })),
          connectors: clipConns,
        };
        return;
      }

      // Duplicate: Ctrl+D
      if (ctrl && e.key === "d") {
        e.preventDefault();
        const sel = selectionRef.current;
        const objs = objectsRef.current;
        const conns = connectorsRef.current;
        const selectedObjs = Array.from(sel.selectedIds)
          .map((id) => objs[id])
          .filter(Boolean);
        if (selectedObjs.length === 0) return;

        const OFFSET = 20;
        const idMap: Record<string, string> = {};

        for (const obj of selectedObjs) {
          const newId = createObject({
            type: obj.type,
            x: obj.x + OFFSET,
            y: obj.y + OFFSET,
            width: obj.width,
            height: obj.height,
            color: obj.color,
            text: obj.text,
            textSize: obj.textSize,
            textColor: obj.textColor,
            rotation: obj.rotation,
            zIndex: obj.zIndex,
            createdBy: userId,
            points: obj.points,
            strokeWidth: obj.strokeWidth,
          });
          idMap[obj.id] = newId;
        }

        for (const conn of Object.values(conns)) {
          if (sel.selectedIds.has(conn.fromId) && sel.selectedIds.has(conn.toId)) {
            const newFromId = idMap[conn.fromId];
            const newToId = idMap[conn.toId];
            if (newFromId && newToId) {
              createConnector({ fromId: newFromId, toId: newToId, style: conn.style });
            }
          }
        }

        sel.selectMultiple(Object.values(idMap));
        return;
      }

      // Text size shortcuts: Cmd/Ctrl+Shift+.</>
      if (ctrl && e.shiftKey && (e.key === "." || e.key === ">" || e.key === "," || e.key === "<")) {
        e.preventDefault();
        const delta = e.key === "." || e.key === ">" ? 2 : -2;
        const sel = selectionRef.current;
        const objs = objectsRef.current;

        sel.selectedIds.forEach((id) => {
          const obj = objs[id];
          if (!obj || !isTextCapableObjectType(obj.type)) return;
          const base = resolveObjectTextSize(obj);
          const next = clampTextSizeForType(obj.type, base + delta);
          updateObject(id, { textSize: next });
        });

        return;
      }

      // Tool shortcuts (only without ctrl)
      if (!ctrl) {
        switch (e.key.toLowerCase()) {
          case "v":
            onToolChange("select");
            break;
          case "s":
            onToolChange("sticky");
            break;
          case "r":
            onToolChange("rectangle");
            break;
          case "c":
            onToolChange("circle");
            break;
          case "a":
            onToolChange("arrow");
            break;
          case "l":
            onToolChange("line");
            break;
          case "f":
            onToolChange("frame");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoRedo, createObject, createConnector, updateObject, userId, canvas, onToolChange, clipboardRef, objectsRef, connectorsRef, selectionRef]);
}
