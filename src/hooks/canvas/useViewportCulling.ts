import { useMemo, useCallback, useRef } from "react";
import type { BoardObject } from "../../types/board";
import type { ViewportState } from "../useCanvas";
import {
  VIEWPORT_CULL_MARGIN as CULL_MARGIN,
  VIEWPORT_HYSTERESIS_PX as HYSTERESIS_PX,
  VIEWPORT_HYSTERESIS_SCALE as HYSTERESIS_SCALE,
} from "../../constants";

export interface FrameClippedData {
  contained: BoardObject[];
  clippedObjects: BoardObject[];
  enteringIds: Set<string>;
}

export interface UseViewportCullingReturn {
  visibleBounds: { left: number; top: number; right: number; bottom: number };
  isInViewport: (obj: BoardObject) => boolean;
  visibleShapes: BoardObject[];
  visibleStickies: BoardObject[];
  visibleFrames: BoardObject[];
  visibleLines: BoardObject[];
  clippedObjectsByFrame: Record<string, FrameClippedData>;
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
  draggingRef: React.MutableRefObject<Set<string>>,
  liveDraggedIds: string[],
  remotePoppedOutDraggedObjectIds: Set<string>,
  enteringFrameDraggedObjects: { frameId: string; object: BoardObject }[],
  objectsByFrame: Record<string, BoardObject[]>
): UseViewportCullingReturn {
  // Refs holding the viewport values used for the last actual bounds computation.
  const lastComputedViewportRef = useRef({ x: Infinity, y: Infinity, scale: Infinity });
  const lastBoundsRef = useRef<{ left: number; top: number; right: number; bottom: number }>({
    left: 0, top: 0, right: 0, bottom: 0,
  });
  const isInViewportRef = useRef<(obj: BoardObject) => boolean>(() => true);

  // We use useEffect to only update the refs when the viewport has moved past the hysteresis threshold.
  // This keeps the visibleBounds reference and isInViewport callback completely stable during small pans,
  // preventing cascading re-evaluations of downstream memos.
  useMemo(() => {
    const prev = lastComputedViewportRef.current;
    if (
      Math.abs(viewport.x - prev.x) >= HYSTERESIS_PX ||
      Math.abs(viewport.y - prev.y) >= HYSTERESIS_PX ||
      Math.abs(viewport.scale - prev.scale) >= HYSTERESIS_SCALE
    ) {
      lastComputedViewportRef.current = { x: viewport.x, y: viewport.y, scale: viewport.scale };
      const invScale = 1 / viewport.scale;
      const bounds = {
        left: -viewport.x * invScale - CULL_MARGIN,
        top: -viewport.y * invScale - CULL_MARGIN,
        right: (-viewport.x + stageWidth) * invScale + CULL_MARGIN,
        bottom: (-viewport.y + stageHeight) * invScale + CULL_MARGIN,
      };
      lastBoundsRef.current = bounds;
      
      isInViewportRef.current = (obj: BoardObject) => {
        return (
          obj.x + obj.width >= bounds.left &&
          obj.x <= bounds.right &&
          obj.y + obj.height >= bounds.top &&
          obj.y <= bounds.bottom
        );
      };
    }
  }, [viewport.x, viewport.y, viewport.scale, stageWidth, stageHeight]);

  const visibleBounds = lastBoundsRef.current;

  const isInViewport = useCallback(
    (obj: BoardObject): boolean => {
      return isInViewportRef.current(obj);
    },
    [] // Completely stable callback!
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

  const clippedObjectsByFrame = useMemo(() => {
    const result: Record<string, FrameClippedData> = {};
    const liveDraggedSet = new Set(liveDraggedIds);
    for (const frame of partitionedObjects.frames) {
      if (!(draggingRef.current.has(frame.id) || isInViewport(frame))) continue;
      const contained = (objectsByFrame[frame.id] || []).filter(
        (cobj) =>
          !remotePoppedOutDraggedObjectIds.has(cobj.id) &&
          (liveDraggedSet.has(cobj.id) || isInViewport(cobj))
      );
      const entering = enteringFrameDraggedObjects
        .filter((e) => e.frameId === frame.id)
        .map((e) => e.object);
      const enteringIds = new Set(entering.map((o) => o.id));
      const clippedObjects = [...contained, ...entering]
        .filter((o) => o.type !== "line")
        .sort((a, b) => {
          const dz = (a.zIndex || 0) - (b.zIndex || 0);
          return dz !== 0 ? dz : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      result[frame.id] = { contained, clippedObjects, enteringIds };
    }
    return result;
  }, [
    visibleBounds,
    objectsByFrame,
    remotePoppedOutDraggedObjectIds,
    liveDraggedIds,
    enteringFrameDraggedObjects,
    partitionedObjects.frames,
    isInViewport,
  ]);

  return {
    visibleBounds,
    isInViewport,
    visibleShapes,
    visibleStickies,
    visibleFrames,
    visibleLines,
    clippedObjectsByFrame,
  };
}
