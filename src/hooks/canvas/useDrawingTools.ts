import { useState, useCallback } from "react";
import type { BoardObject } from "../../types/board";
import type { ToolType } from "../../types/tool";
import { computeFrameFromGesture } from "../../utils/frame";
import type { UndoAction } from "../useUndoRedo";

// Frame layout constants
const MIN_FRAME_WIDTH = 200;
const MIN_FRAME_HEIGHT = 150;
const DEFAULT_FRAME_WIDTH = 800;
const DEFAULT_FRAME_HEIGHT = 600;
const FRAME_CLICK_THRESHOLD = 6;

export interface DrawState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface UseDrawingToolsReturn {
  frameDraw: DrawState | null;
  shapeDraw: DrawState | null;
  /** Update drawing preview on mouse move */
  onMouseMove: (canvasPoint: { x: number; y: number }) => void;
  /** Start drawing on mouse down. Returns true if handled. */
  onMouseDown: (canvasPoint: { x: number; y: number }) => boolean;
  /** Finalize drawing on mouse up. Returns true if handled. */
  onMouseUp: () => boolean;
  /** Cancel all drawing (e.g. on Escape) */
  cancel: () => void;
}

export function useDrawingTools(
  activeTool: ToolType,
  activeColor: string,
  currentUserId: string,
  objectsRef: React.MutableRefObject<Record<string, BoardObject>>,
  onCreateObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string,
  onPushUndo: (action: UndoAction) => void,
  onResetTool: (selectId?: string) => void,
  getFrameAtPoint: (x: number, y: number) => BoardObject | null
): UseDrawingToolsReturn {
  const [frameDraw, setFrameDraw] = useState<DrawState | null>(null);
  const [shapeDraw, setShapeDraw] = useState<DrawState | null>(null);

  const onMouseMove = useCallback(
    (canvasPoint: { x: number; y: number }) => {
      // Frame drawing preview
      if (frameDraw && activeTool === "frame") {
        setFrameDraw((prev) =>
          prev ? { ...prev, endX: canvasPoint.x, endY: canvasPoint.y } : null
        );
      }

      // Shape drawing preview (rectangle / circle / sticky drag-to-create)
      if (shapeDraw && (activeTool === "rectangle" || activeTool === "circle" || activeTool === "sticky")) {
        setShapeDraw((prev) => {
          if (!prev) return null;
          let endX = canvasPoint.x;
          let endY = canvasPoint.y;
          if (activeTool === "circle" || activeTool === "sticky") {
            const dx = endX - prev.startX;
            const dy = endY - prev.startY;
            const side = Math.max(Math.abs(dx), Math.abs(dy));
            endX = prev.startX + side * Math.sign(dx || 1);
            endY = prev.startY + side * Math.sign(dy || 1);
          }
          return { ...prev, endX, endY };
        });
      }
    },
    [activeTool, frameDraw, shapeDraw]
  );

  const onMouseDown = useCallback(
    (canvasPoint: { x: number; y: number }): boolean => {
      if (activeTool === "frame") {
        setFrameDraw({
          startX: canvasPoint.x,
          startY: canvasPoint.y,
          endX: canvasPoint.x,
          endY: canvasPoint.y,
        });
        return true;
      }

      if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "sticky") {
        setShapeDraw({
          startX: canvasPoint.x,
          startY: canvasPoint.y,
          endX: canvasPoint.x,
          endY: canvasPoint.y,
        });
        return true;
      }

      return false;
    },
    [activeTool]
  );

  const onMouseUp = useCallback((): boolean => {
    // Frame creation
    if (activeTool === "frame" && frameDraw) {
      const frameRect = computeFrameFromGesture({
        startX: frameDraw.startX,
        startY: frameDraw.startY,
        endX: frameDraw.endX,
        endY: frameDraw.endY,
        clickThreshold: FRAME_CLICK_THRESHOLD,
        defaultWidth: DEFAULT_FRAME_WIDTH,
        defaultHeight: DEFAULT_FRAME_HEIGHT,
        minWidth: MIN_FRAME_WIDTH,
        minHeight: MIN_FRAME_HEIGHT,
      });

      const minZIndex = Math.min(0, ...Object.values(objectsRef.current).map((o) => o.zIndex || 0));
      const newId = onCreateObject({
        type: "frame",
        x: frameRect.x,
        y: frameRect.y,
        width: frameRect.width,
        height: frameRect.height,
        color: "#F8FAFC",
        text: "Frame",
        rotation: 0,
        zIndex: minZIndex - 1,
        createdBy: currentUserId,
      });

      setTimeout(() => {
        const created = objectsRef.current[newId];
        if (created) {
          onPushUndo({ type: "create_object", objectId: newId, object: created });
        }
      }, 100);

      setFrameDraw(null);
      onResetTool(newId);
      return true;
    }

    // Shape creation (rectangle / circle / sticky)
    if ((activeTool === "rectangle" || activeTool === "circle" || activeTool === "sticky") && shapeDraw) {
      const SHAPE_CLICK_THRESHOLD = 5;
      const dx = Math.abs(shapeDraw.endX - shapeDraw.startX);
      const dy = Math.abs(shapeDraw.endY - shapeDraw.startY);
      const isClick = dx < SHAPE_CLICK_THRESHOLD && dy < SHAPE_CLICK_THRESHOLD;

      const { x, y, w, h } = (() => {
        if (isClick) {
          const [width, height] =
            activeTool === "rectangle" ? [150, 100] :
            activeTool === "circle" ? [100, 100] :
            [150, 150];
          return {
            x: shapeDraw.startX - width / 2,
            y: shapeDraw.startY - height / 2,
            w: width,
            h: height,
          };
        }
        let width = Math.max(20, dx);
        let height = Math.max(20, dy);
        if (activeTool === "circle" || activeTool === "sticky") {
          const side = Math.max(width, height);
          width = side;
          height = side;
        }
        return {
          x: Math.min(shapeDraw.startX, shapeDraw.endX),
          y: Math.min(shapeDraw.startY, shapeDraw.endY),
          w: width,
          h: height,
        };
      })();

      const objType = activeTool === "sticky" ? "sticky" : activeTool;
      // Use Date.now() as zIndex so concurrent users creating objects in the
      // same instant each get a distinct timestamp, virtually eliminating the
      // "same zIndex" collision that causes z-order disagreement across clients.
      // BIGINT in Postgres safely holds the ~1.7 trillion ms epoch value.
      const parentFrame = getFrameAtPoint(x + w / 2, y + h / 2);
      const newId = onCreateObject({
        type: objType,
        x, y,
        width: w,
        height: h,
        color: activeColor,
        text: "",
        rotation: 0,
        zIndex: Date.now(),
        createdBy: currentUserId,
        parentFrameId: parentFrame?.id ?? null,
      });

      setTimeout(() => {
        const created = objectsRef.current[newId];
        if (created) {
          onPushUndo({ type: "create_object", objectId: newId, object: created });
        }
      }, 100);

      setShapeDraw(null);
      onResetTool(newId);
      return true;
    }

    return false;
  }, [activeTool, frameDraw, shapeDraw, activeColor, currentUserId, objectsRef, onCreateObject, onPushUndo, onResetTool, getFrameAtPoint]);

  const cancel = useCallback(() => {
    setFrameDraw(null);
    setShapeDraw(null);
  }, []);

  return {
    frameDraw,
    shapeDraw,
    onMouseMove,
    onMouseDown,
    onMouseUp,
    cancel,
  };
}
