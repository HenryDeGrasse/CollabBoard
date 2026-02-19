import { useMemo, useCallback } from "react";
import type { BoardObject } from "../types/board";
import type { ViewportState } from "./useCanvas";

const CULL_MARGIN = 200; // Extra margin (canvas px) to avoid pop-in during pan

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
  const visibleBounds = useMemo(() => {
    const invScale = 1 / viewport.scale;
    return {
      left: -viewport.x * invScale - CULL_MARGIN,
      top: -viewport.y * invScale - CULL_MARGIN,
      right: (-viewport.x + stageWidth) * invScale + CULL_MARGIN,
      bottom: (-viewport.y + stageHeight) * invScale + CULL_MARGIN,
    };
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
