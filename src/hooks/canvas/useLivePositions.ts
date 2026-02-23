import { useMemo, useCallback, useRef, useEffect } from "react";
import type { BoardObject } from "../../types/board";
import { shouldPopOutFromFrame } from "../../utils/frame";

export interface LiveDragPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface RemoteDragPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
  parentFrameId?: string | null;
  userId: string;
  updatedAt: number;
}

export interface EnteringFrameEntry {
  frameId: string;
  object: BoardObject;
}

export interface UseLivePositionsReturn {
  /** Merged local + remote drag positions (local takes precedence) */
  liveDragPositions: Record<string, LiveDragPosition>;
  /** Merged local + remote parent frame IDs during drag */
  liveParentFrameIds: Record<string, string | null>;
  /** Resolved positions with frame-child inference for missing packets */
  resolvedLiveDragPositions: Record<string, LiveDragPosition>;
  /** Objects map with live drag positions applied (cached for referential equality) */
  objectsWithLivePositions: Record<string, BoardObject>;
  /** Get an object with its live drag position applied */
  withLivePosition: (obj: BoardObject) => BoardObject;
  /** Objects being dragged out of their parent frame */
  poppedOutDraggedObjects: BoardObject[];
  /** IDs of objects being dragged out of their parent frame */
  poppedOutDraggedObjectIds: Set<string>;
  /** Objects being dragged into a frame (with target frameId) */
  enteringFrameDraggedObjects: EnteringFrameEntry[];
  /** IDs of remote objects entering a frame during drag */
  remoteEnteringDraggedObjectIds: Set<string>;
  /** IDs of remote objects popped out of a frame during drag */
  remotePoppedOutDraggedObjectIds: Set<string>;
}

export function useLivePositions(
  objects: Record<string, BoardObject>,
  dragPositions: Record<string, { x: number; y: number }>,
  dragParentFrameIds: Record<string, string | null>,
  remoteDragPositions: Record<string, RemoteDragPosition>,
  dragInsideFrameRef: React.MutableRefObject<Set<string>>,
  /** Pre-computed map from useObjectPartitioning: frameId → contained children */
  objectsByFrame?: Record<string, BoardObject[]>,
  /** Pre-sorted frames from useObjectPartitioning (zIndex ascending) */
  sortedFrames?: BoardObject[]
): UseLivePositionsReturn {
  const liveDragPositions = useMemo(() => {
    const merged: Record<string, LiveDragPosition> = {};

    for (const [id, pos] of Object.entries(remoteDragPositions)) {
      merged[id] = {
        x: pos.x,
        y: pos.y,
        ...(typeof pos.width === "number" ? { width: pos.width } : {}),
        ...(typeof pos.height === "number" ? { height: pos.height } : {}),
      };
    }

    // Local drag preview takes precedence over remote preview for same object id.
    for (const [id, pos] of Object.entries(dragPositions)) {
      merged[id] = { ...merged[id], ...pos };
    }

    return merged;
  }, [remoteDragPositions, dragPositions]);

  const liveParentFrameIds = useMemo(() => {
    const merged: Record<string, string | null> = {};

    for (const [id, pos] of Object.entries(remoteDragPositions)) {
      if (pos.parentFrameId !== undefined) {
        merged[id] = pos.parentFrameId;
      }
    }

    for (const [id, parentFrameId] of Object.entries(dragParentFrameIds)) {
      merged[id] = parentFrameId;
    }

    return merged;
  }, [remoteDragPositions, dragParentFrameIds]);

  // IDs currently carrying live drag positions (local or remote).
  // Shared by pop-out + entering-frame calculations so we don't scan the
  // entire objects map when only a handful of objects are moving.
  const liveDraggedIds = useMemo(
    () => Object.keys(liveDragPositions),
    [liveDragPositions]
  );

  // Resolve live positions for rendering:
  // - explicit drag packets (local/remote) always win
  // - if a frame moves but some child packets are delayed/dropped,
  //   derive child preview positions from frame delta so motion stays cohesive.
  const resolvedLiveDragPositions = useMemo(() => {
    // No drag positions at all — return empty (stable reference when possible)
    if (Object.keys(liveDragPositions).length === 0) return liveDragPositions;

    const resolved: Record<string, LiveDragPosition> = {
      ...liveDragPositions,
    };

    // Use pre-computed frame list if available, otherwise fall back to filter.
    const frames = sortedFrames
      ? sortedFrames
      : Object.values(objects).filter((o) => o.type === "frame");
    if (frames.length === 0) return resolved;

    for (const frame of frames) {
      const liveFrame = liveDragPositions[frame.id];
      if (!liveFrame) continue;

      const dx = liveFrame.x - frame.x;
      const dy = liveFrame.y - frame.y;
      if (dx === 0 && dy === 0) continue;

      // Use pre-computed objectsByFrame index for O(children) instead of O(all objects).
      const children = objectsByFrame
        ? (objectsByFrame[frame.id] || [])
        : Object.values(objects).filter(
            (o) => o.type !== "frame" && o.parentFrameId === frame.id
          );

      for (const obj of children) {
        if (resolved[obj.id]) continue;

        resolved[obj.id] = {
          x: obj.x + dx,
          y: obj.y + dy,
        };
      }
    }

    return resolved;
  }, [liveDragPositions, objects, objectsByFrame, sortedFrames]);

  // Pre-compute objects with live drag positions applied.
  // Caches merged objects between renders to preserve referential equality
  // and reduce GC pressure from per-object spread on every render.
  const livePositionCacheRef = useRef<Map<string, BoardObject>>(new Map());
  // Previous base objects ref — used to detect when only drag positions changed
  // so we can do a fast incremental update instead of iterating all objects.
  const prevObjectsRef = useRef<Record<string, BoardObject> | null>(null);
  const prevResultRef = useRef<Record<string, BoardObject> | null>(null);
  const objectsWithLivePositions = useMemo(() => {
    const cache = livePositionCacheRef.current;
    const liveIds = Object.keys(resolvedLiveDragPositions);

    // NEW: Isomorphic Short-circuit
    // If no one is dragging anything, we can return the objects dictionary directly.
    if (liveIds.length === 0) {
      return objects;
    }

    // Fast path: if the base objects record hasn't changed (same reference),
    // only update the entries that have live positions. This avoids iterating
    // all 800+ objects when only a few are being dragged.
    if (prevObjectsRef.current === objects && prevResultRef.current && liveIds.length < 100) {
      const result = { ...prevResultRef.current };

      // Restore previously-overridden entries back to their base object
      for (const cachedId of cache.keys()) {
        if (!resolvedLiveDragPositions[cachedId]) {
          result[cachedId] = objects[cachedId] || result[cachedId];
          cache.delete(cachedId);
        }
      }

      // Apply current live positions
      for (const id of liveIds) {
        const obj = objects[id];
        if (!obj) continue;
        const live = resolvedLiveDragPositions[id];
        const cached = cache.get(id);
        if (
          cached &&
          cached.x === live.x &&
          cached.y === live.y &&
          (live.width === undefined || cached.width === live.width) &&
          (live.height === undefined || cached.height === live.height)
        ) {
          result[id] = cached;
        } else {
          const merged = { ...obj, ...live };
          cache.set(id, merged);
          result[id] = merged;
        }
      }

      prevResultRef.current = result;
      return result;
    }

    // Full rebuild when base objects changed
    const result: Record<string, BoardObject> = {};

    for (const [id, obj] of Object.entries(objects)) {
      const live = resolvedLiveDragPositions[id];
      if (!live) {
        result[id] = obj; // No copy needed — original reference
        cache.delete(id);
        continue;
      }

      const cached = cache.get(id);
      if (
        cached &&
        cached.x === live.x &&
        cached.y === live.y &&
        (live.width === undefined || cached.width === live.width) &&
        (live.height === undefined || cached.height === live.height)
      ) {
        result[id] = cached; // Reuse cached merged object
      } else {
        const merged = { ...obj, ...live };
        cache.set(id, merged);
        result[id] = merged;
      }
    }

    // Clean stale entries
    for (const cachedId of cache.keys()) {
      if (!objects[cachedId]) cache.delete(cachedId);
    }

    prevObjectsRef.current = objects;
    prevResultRef.current = result;
    return result;
  }, [objects, resolvedLiveDragPositions]);

  const withLivePosition = useCallback(
    (obj: BoardObject): BoardObject => {
      return objectsWithLivePositions[obj.id] || obj;
    },
    [objectsWithLivePositions]
  );

  const poppedOutDraggedObjects = useMemo(() => {
    if (liveDraggedIds.length === 0) return [];

    const popped: BoardObject[] = [];

    for (const id of liveDraggedIds) {
      const obj = objects[id];
      if (!obj || !obj.parentFrameId) continue;

      const live = liveDragPositions[id];
      if (!live) continue;

      const parent = objects[obj.parentFrameId];
      if (!parent || parent.type !== "frame") continue;

      // Hysteresis: objects currently inside use lower exit threshold (0.45)
      const wasInside = dragInsideFrameRef.current.has(id);
      const threshold = wasInside ? 0.45 : 0.5;
      const shouldPop = shouldPopOutFromFrame(
        {
          x: live.x,
          y: live.y,
          width: live.width ?? obj.width,
          height: live.height ?? obj.height,
        },
        { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
        threshold
      );

      if (shouldPop) {
        dragInsideFrameRef.current.delete(id);
        popped.push({
          ...obj,
          ...live,
          width: live.width ?? obj.width,
          height: live.height ?? obj.height,
        });
      } else {
        dragInsideFrameRef.current.add(id);
      }
    }

    popped.sort((a, b) => {
      const dz = (a.zIndex || 0) - (b.zIndex || 0);
      return dz !== 0 ? dz : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return popped;
  }, [objects, liveDragPositions, liveDraggedIds, dragInsideFrameRef]);

  // IDs of objects currently being dragged out of their frame (for connector rendering)
  const poppedOutDraggedObjectIds = useMemo(
    () => new Set(poppedOutDraggedObjects.map((o) => o.id)),
    [poppedOutDraggedObjects]
  );

  // While dragging uncontained objects into a frame, show a live in-frame preview.
  // Hysteresis: entering uses higher threshold (0.55), staying in uses lower (0.45).
  const enteringFrameDraggedObjects = useMemo(() => {
    if (liveDraggedIds.length === 0) return [];

    // Reuse pre-sorted frames (ascending zIndex) from useObjectPartitioning,
    // reversed to descending so topmost frame wins the containment test.
    const frames = sortedFrames
      ? [...sortedFrames].reverse()
      : Object.values(objects)
          .filter((o) => o.type === "frame")
          .sort((a, b) => {
            const dz = (b.zIndex || 0) - (a.zIndex || 0);
            return dz !== 0 ? dz : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
          });

    if (frames.length === 0) return [];

    const frameById = new Map(frames.map((f) => [f.id, f]));
    const entering: EnteringFrameEntry[] = [];

    for (const id of liveDraggedIds) {
      const obj = objects[id];
      if (!obj || obj.parentFrameId || obj.type === "frame") continue;

      const live = liveDragPositions[id];
      if (!live) continue;

      // If drag source provided an explicit frame membership preview, trust it.
      const forcedFrameId = liveParentFrameIds[id];
      if (forcedFrameId) {
        const forcedFrame = frameById.get(forcedFrameId);
        if (forcedFrame) {
          dragInsideFrameRef.current.add(id);
          entering.push({
            frameId: forcedFrame.id,
            object: {
              ...obj,
              ...live,
              width: live.width ?? obj.width,
              height: live.height ?? obj.height,
            },
          });
          continue;
        }
      }

      const wasInside = dragInsideFrameRef.current.has(id);
      const threshold = wasInside ? 0.45 : 0.55;

      let targetFrame: BoardObject | undefined;
      for (const frame of frames) {
        const inFrame = !shouldPopOutFromFrame(
          {
            x: live.x,
            y: live.y,
            width: live.width ?? obj.width,
            height: live.height ?? obj.height,
          },
          { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          threshold
        );
        if (inFrame) {
          targetFrame = frame;
          break;
        }
      }

      if (targetFrame) {
        dragInsideFrameRef.current.add(id);
        entering.push({
          frameId: targetFrame.id,
          object: {
            ...obj,
            ...live,
            width: live.width ?? obj.width,
            height: live.height ?? obj.height,
          },
        });
      } else {
        dragInsideFrameRef.current.delete(id);
      }
    }

    return entering;
  }, [
    objects,
    liveDragPositions,
    liveDraggedIds,
    liveParentFrameIds,
    dragInsideFrameRef,
    sortedFrames,
  ]);

  const remoteEnteringDraggedObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of enteringFrameDraggedObjects) {
      const id = entry.object.id;
      if (remoteDragPositions[id] && !dragPositions[id]) {
        ids.add(id);
      }
    }
    return ids;
  }, [enteringFrameDraggedObjects, remoteDragPositions, dragPositions]);

  const remotePoppedOutDraggedObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const obj of poppedOutDraggedObjects) {
      const id = obj.id;
      if (remoteDragPositions[id] && !dragPositions[id]) {
        ids.add(id);
      }
    }
    return ids;
  }, [poppedOutDraggedObjects, remoteDragPositions, dragPositions]);

  // Clean up dragInsideFrameRef when drag positions are cleared
  useEffect(() => {
    const liveIds = new Set(liveDraggedIds);
    dragInsideFrameRef.current.forEach((id) => {
      if (!liveIds.has(id)) {
        dragInsideFrameRef.current.delete(id);
      }
    });
  }, [liveDraggedIds, dragInsideFrameRef]);

  return {
    liveDragPositions,
    liveParentFrameIds,
    resolvedLiveDragPositions,
    objectsWithLivePositions,
    withLivePosition,
    poppedOutDraggedObjects,
    poppedOutDraggedObjectIds,
    enteringFrameDraggedObjects,
    remoteEnteringDraggedObjectIds,
    remotePoppedOutDraggedObjectIds,
  };
}
