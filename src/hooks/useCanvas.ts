import { useState, useRef, useCallback } from "react";
import Konva from "konva";

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4.0;
const SCALE_BY = 1.05;

export interface UseCanvasReturn {
  viewport: ViewportState;
  setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  onWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
}

export function useCanvas(): UseCanvasReturn {
  const [viewport, setViewport] = useState<ViewportState>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const stageRef = useRef<Konva.Stage | null>(null);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = e.target.getStage();
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    let newScale = direction > 0 ? oldScale * SCALE_BY : oldScale / SCALE_BY;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    setViewport({
      x: newPos.x,
      y: newPos.y,
      scale: newScale,
    });
  }, []);

  const onDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    // Only handle stage drag (not object drag)
    if (e.target !== e.target.getStage()) return;

    setViewport((prev) => ({
      ...prev,
      x: e.target.x(),
      y: e.target.y(),
    }));
  }, []);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const stage = stageRef.current;
      if (!stage) {
        return { x: screenX, y: screenY };
      }
      const transform = stage.getAbsoluteTransform().copy();
      transform.invert();
      return transform.point({ x: screenX, y: screenY });
    },
    []
  );

  return {
    viewport,
    setViewport,
    onWheel,
    onDragEnd,
    stageRef,
    screenToCanvas,
  };
}
