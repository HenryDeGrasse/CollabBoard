import { useMemo, useCallback, useRef } from "react";
import type { BoardObject } from "../types/board";
import type { ViewportState } from "./useCanvas";

const CULL_MARGIN = 200; // Extra margin (canvas px) to avoid pop-in during pan

// Hysteresis thresholds: don't recompute visibleBounds unless the viewport
// has moved more than this many screen-pixels or the scale has changed.
// Keeps the four visible* filter memos stable during small incremental pans,
// preventing O(N) re-filtering on every pixel of movement.
const HYSTERESIS_PX = 100;
const HYSTERESIS_SCALE = 0.02;

export interface UseViewportCullingReturn {
  visibleBounds: { left: number; top: number; right: number; bottom: number };
  isInViewport: (obj: BoardObject) => boolean;
  visibleShapes: BoardObject[];
  visibleStickies: BoardObject[];
  visibleFrames: BoardObject[];
  visibleLines: BoardObject[];
}

export function useViewportCulling(
  viewport: ViewportState,
  stageWidth: number,
  stageHeight: number,
  partitionedObjects: {
    uncontainedShapes: BoardObject[];
    uncontainedStickies: BoardObject[];
    frames: BoardObject[];
    lines: BoardObject[];
  },
  draggingRef: React.MutableRefObject<Set<string>>
): UseViewportCullingReturn {
  // Refs holding the viewport values used for the last actual bounds computation.
  // When the viewport moves less than the hysteresis thresholds we return the
  // cached bounds object (same reference), which keeps isInViewport stable and
  // prevents the four visible* filter memos from re-running on every pan pixel.
  const lastComputedViewportRef = useRef({ x: Infinity, y: Infinity, scale: Infinity });
  const lastBoundsRef = useRef<{ left: number; top: number; right: number; bottom: number }>({
    left: 0, top: 0, right: 0, bottom: 0,
  });

  const visibleBounds = useMemo(() => {
    const prev = lastComputedViewportRef.current;
    if (
      Math.abs(viewport.x - prev.x) < HYSTERESIS_PX &&
      Math.abs(viewport.y - prev.y) < HYSTERESIS_PX &&
      Math.abs(viewport.scale - prev.scale) < HYSTERESIS_SCALE
    ) {
      // Viewport hasn't moved enough to warrant a bounds recompute.
      // Return the stable cached reference so downstream memos don't invalidate.
      return lastBoundsRef.current;
    }

    lastComputedViewportRef.current = { x: viewport.x, y: viewport.y, scale: viewport.scale };
    const invScale = 1 / viewport.scale;
    const bounds = {
      left: -viewport.x * invScale - CULL_MARGIN,
      top: -viewport.y * invScale - CULL_MARGIN,
      right: (-viewport.x + stageWidth) * invScale + CULL_MARGIN,
      bottom: (-viewport.y + stageHeight) * invScale + CULL_MARGIN,
    };
    lastBoundsRef.current = bounds;
    return bounds;
  }, [viewport.x, viewport.y, viewport.scale, stageWidth, stageHeight]);

  const isInViewport = useCallback(
    (obj: BoardObject): boolean => {
      return (
        obj.x + obj.width >= visibleBounds.left &&
        obj.x <= visibleBounds.right &&
        obj.y + obj.height >= visibleBounds.top &&
        obj.y <= visibleBounds.bottom
      );
    },
    [visibleBounds]
  );

  const visibleShapes = useMemo(
    () =>
      partitionedObjects.uncontainedShapes.filter(
        (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
      ),
    [partitionedObjects.uncontainedShapes, isInViewport]
  );

  const visibleStickies = useMemo(
    () =>
      partitionedObjects.uncontainedStickies.filter(
        (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
      ),
    [partitionedObjects.uncontainedStickies, isInViewport]
  );

  const visibleFrames = useMemo(
    () =>
      partitionedObjects.frames.filter(
        (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
      ),
    [partitionedObjects.frames, isInViewport]
  );

  const visibleLines = useMemo(
    () =>
      partitionedObjects.lines.filter(
        (obj) => draggingRef.current.has(obj.id) || isInViewport(obj)
      ),
    [partitionedObjects.lines, isInViewport]
  );

  return {
    visibleBounds,
    isInViewport,
    visibleShapes,
    visibleStickies,
    visibleFrames,
    visibleLines,
  };
}
