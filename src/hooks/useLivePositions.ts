import { useMemo, useCallback, useRef, useEffect } from "react";
import type { BoardObject } from "../types/board";
import { shouldPopOutFromFrame } from "../utils/frame-containment";

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
  dragInsideFrameRef: React.MutableRefObject<Set<string>>
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

  // Resolve live positions for rendering:
  // - explicit drag packets (local/remote) always win
  // - if a frame moves but some child packets are delayed/dropped,
  //   derive child preview positions from frame delta so motion stays cohesive.
  const resolvedLiveDragPositions = useMemo(() => {
    const resolved: Record<string, LiveDragPosition> = {
      ...liveDragPositions,
    };

    const frames = Object.values(objects).filter((o) => o.type === "frame");
    if (frames.length === 0) return resolved;

    for (const frame of frames) {
      const liveFrame = liveDragPositions[frame.id];
      if (!liveFrame) continue;

      const dx = liveFrame.x - frame.x;
      const dy = liveFrame.y - frame.y;
      if (dx === 0 && dy === 0) continue;

      for (const obj of Object.values(objects)) {
        if (obj.type === "frame" || obj.parentFrameId !== frame.id) continue;
        if (resolved[obj.id]) continue;

        resolved[obj.id] = {
          x: obj.x + dx,
          y: obj.y + dy,
        };
      }
    }

    return resolved;
  }, [liveDragPositions, objects]);

  // Pre-compute objects with live drag positions applied.
  // Caches merged objects between renders to preserve referential equality
  // and reduce GC pressure from per-object spread on every render.
  const livePositionCacheRef = useRef<Map<string, BoardObject>>(new Map());
  const objectsWithLivePositions = useMemo(() => {
    const cache = livePositionCacheRef.current;
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

    return result;
  }, [objects, resolvedLiveDragPositions]);

  const withLivePosition = useCallback(
    (obj: BoardObject): BoardObject => {
      return objectsWithLivePositions[obj.id] || obj;
    },
    [objectsWithLivePositions]
  );

  const poppedOutDraggedObjects = useMemo(() => {
    return Object.values(objects)
      .filter((obj) => !!obj.parentFrameId && !!liveDragPositions[obj.id])
      .map((obj) => {
        const live = liveDragPositions[obj.id]!;
        const parent = obj.parentFrameId ? objects[obj.parentFrameId] : undefined;
        if (!parent || parent.type !== "frame") return null;

        // Hysteresis: objects currently inside use lower exit threshold (0.45)
        const wasInside = dragInsideFrameRef.current.has(obj.id);
        const threshold = wasInside ? 0.45 : 0.5;
        const shouldPop = shouldPopOutFromFrame(
          { x: live.x, y: live.y, width: obj.width, height: obj.height },
          { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
          threshold
        );

        if (shouldPop) {
          dragInsideFrameRef.current.delete(obj.id);
          return { ...obj, x: live.x, y: live.y };
        } else {
          dragInsideFrameRef.current.add(obj.id);
          return null;
        }
      })
      .filter((obj): obj is BoardObject => !!obj)
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  }, [objects, liveDragPositions, dragInsideFrameRef]);

  // IDs of objects currently being dragged out of their frame (for connector rendering)
  const poppedOutDraggedObjectIds = useMemo(
    () => new Set(poppedOutDraggedObjects.map((o) => o.id)),
    [poppedOutDraggedObjects]
  );

  // While dragging uncontained objects into a frame, show a live in-frame preview.
  // Hysteresis: entering uses higher threshold (0.55), staying in uses lower (0.45).
  const enteringFrameDraggedObjects = useMemo(() => {
    const frames = Object.values(objects)
      .filter((o) => o.type === "frame")
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    return Object.values(objects)
      .filter((obj) => !obj.parentFrameId && !!liveDragPositions[obj.id] && obj.type !== "frame")
      .map((obj) => {
        const live = liveDragPositions[obj.id]!;

        // If drag source provided an explicit frame membership preview, trust it.
        const forcedFrameId = liveParentFrameIds[obj.id];
        if (forcedFrameId) {
          const forcedFrame = frames.find((f) => f.id === forcedFrameId);
          if (forcedFrame) {
            dragInsideFrameRef.current.add(obj.id);
            return {
              frameId: forcedFrame.id,
              object: { ...obj, x: live.x, y: live.y } as BoardObject,
            };
          }
        }

        const wasInside = dragInsideFrameRef.current.has(obj.id);
        const threshold = wasInside ? 0.45 : 0.55;

        const targetFrame = frames.find((frame) => {
          return !shouldPopOutFromFrame(
            { x: live.x, y: live.y, width: obj.width, height: obj.height },
            { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
            threshold
          );
        });

        if (targetFrame) {
          dragInsideFrameRef.current.add(obj.id);
          return {
            frameId: targetFrame.id,
            object: { ...obj, x: live.x, y: live.y } as BoardObject,
          };
        } else {
          dragInsideFrameRef.current.delete(obj.id);
          return null;
        }
      })
      .filter((entry): entry is EnteringFrameEntry => !!entry);
  }, [objects, liveDragPositions, liveParentFrameIds, dragInsideFrameRef]);

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
    const liveIds = new Set(Object.keys(liveDragPositions));
    dragInsideFrameRef.current.forEach((id) => {
      if (!liveIds.has(id)) {
        dragInsideFrameRef.current.delete(id);
      }
    });
  }, [liveDragPositions, dragInsideFrameRef]);

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
