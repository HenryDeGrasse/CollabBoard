import { useState, useRef, useCallback, useEffect } from "react";
import Konva from "konva";

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4.0;
const SCALE_BY = 1.05;

// Debounce interval for persisting viewport to localStorage (ms).
const VIEWPORT_SAVE_DEBOUNCE = 300;

function viewportStorageKey(boardId: string): string {
  return `collabboard:viewport:${boardId}`;
}

function loadSavedViewport(boardId: string): ViewportState | null {
  if (!boardId) return null;
  try {
    const raw = localStorage.getItem(viewportStorageKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.scale === "number" &&
      parsed.scale >= MIN_SCALE &&
      parsed.scale <= MAX_SCALE
    ) {
      return { x: parsed.x, y: parsed.y, scale: parsed.scale };
    }
  } catch {
    // Corrupt data — ignore.
  }
  return null;
}

export interface UseCanvasReturn {
  viewport: ViewportState;
  setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  onWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
}

export function useCanvas(boardId?: string): UseCanvasReturn {
  const [viewport, setViewport] = useState<ViewportState>(() => {
    if (boardId) {
      const saved = loadSavedViewport(boardId);
      if (saved) return saved;
    }
    return { x: 0, y: 0, scale: 1 };
  });

  // Persist viewport changes to localStorage (debounced).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  useEffect(() => {
    if (!boardId) return;

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      try {
        localStorage.setItem(
          viewportStorageKey(boardId),
          JSON.stringify(viewportRef.current)
        );
      } catch {
        // localStorage full or unavailable — ignore.
      }
    }, VIEWPORT_SAVE_DEBOUNCE);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [boardId, viewport]);

  // Flush on unmount / page hide so we don't lose the last position.
  useEffect(() => {
    if (!boardId) return;

    const flush = () => {
      try {
        localStorage.setItem(
          viewportStorageKey(boardId),
          JSON.stringify(viewportRef.current)
        );
      } catch {
        // ignore
      }
    };

    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });

    return () => {
      window.removeEventListener("beforeunload", flush);
      flush(); // Save on component unmount too.
    };
  }, [boardId]);
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
