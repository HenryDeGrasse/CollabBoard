import { useState, useRef, useCallback, useEffect } from "react";
import Konva from "konva";

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4.0;
const SCALE_BY = 1.08;

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

// Delay (ms) after the last wheel event before we consider zooming finished.
const ZOOM_IDLE_TIMEOUT = 150;

export interface UseCanvasReturn {
  viewport: ViewportState;
  setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  isZooming: boolean;
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
  // Uses a ref-based approach to avoid running a React effect on every viewport
  // change, which would create/clear timeouts 60 times/sec during zoom.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const scheduleSave = useCallback(() => {
    if (!boardId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
  }, [boardId]);

  // Schedule a save whenever viewport changes, but outside the React effect cycle.
  const prevViewportRef = useRef(viewport);
  if (prevViewportRef.current !== viewport) {
    prevViewportRef.current = viewport;
    scheduleSave();
  }

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

  // Track whether the user is actively zooming so consumers can enable
  // performance optimizations (e.g. layer caching).
  const [isZooming, setIsZooming] = useState(false);
  const isZoomingRef = useRef(false);
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch rapid wheel events (e.g. trackpad zoom) into a single RAF update.
  const pendingWheelRef = useRef<ViewportState | null>(null);
  const wheelRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
      }
      if (zoomTimeoutRef.current !== null) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = e.target.getStage();
    if (!stage) return;

    // Use the pending viewport if one exists (multiple wheel events in same frame),
    // otherwise read current stage values.
    const baseScale = pendingWheelRef.current?.scale ?? stage.scaleX();
    const baseX = pendingWheelRef.current?.x ?? stage.x();
    const baseY = pendingWheelRef.current?.y ?? stage.y();

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - baseX) / baseScale,
      y: (pointer.y - baseY) / baseScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    let newScale = direction > 0 ? baseScale * SCALE_BY : baseScale / SCALE_BY;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    const pending: ViewportState = { x: newPos.x, y: newPos.y, scale: newScale };
    pendingWheelRef.current = pending;

    // Mark as zooming; clear after ZOOM_IDLE_TIMEOUT ms of no wheel events.
    if (!isZoomingRef.current) {
      isZoomingRef.current = true;
      setIsZooming(true);
    }
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
    zoomTimeoutRef.current = setTimeout(() => {
      isZoomingRef.current = false;
      setIsZooming(false);
      // Commit final viewport to React state so Board re-renders once with
      // correct culling / layout. Read from the ref since pendingWheelRef
      // may have been consumed by a prior rAF.
      setViewport(viewportRef.current);
    }, ZOOM_IDLE_TIMEOUT);

    // During zoom: apply transform directly to the Konva Stage node and
    // update the viewportRef (for localStorage saves + zoom indicator),
    // but do NOT call setViewport — this skips the entire React render
    // cascade (Board JSX reconciliation of hundreds of objects).
    // React state is committed once when zooming stops (timeout above).
    if (wheelRafRef.current === null) {
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const final = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (final) {
          // Apply directly to Konva — no React render
          stage.x(final.x);
          stage.y(final.y);
          stage.scaleX(final.scale);
          stage.scaleY(final.scale);
          stage.batchDraw();
          // Keep ref in sync for localStorage persistence + screenToCanvas
          viewportRef.current = final;
        }
      });
    }
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
    isZooming,
    onWheel,
    onDragEnd,
    stageRef,
    screenToCanvas,
  };
}
