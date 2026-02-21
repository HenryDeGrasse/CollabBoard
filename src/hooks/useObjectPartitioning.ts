import { useMemo } from "react";
import type { BoardObject, Connector } from "../types/board";
import {
  getFrameHeaderHeight,
  FRAME_HEADER_MIN_HEIGHT,
} from "../utils/text-style";
import { minFrameSizeForChildren } from "../utils/frame-containment";

const DEFAULT_TITLE_HEIGHT = FRAME_HEADER_MIN_HEIGHT;
const MIN_FRAME_WIDTH = 200;
const MIN_FRAME_HEIGHT = 150;
const FRAME_CONTENT_PADDING = 6;

export interface UseObjectPartitioningReturn {
  /** All objects sorted by zIndex ascending */
  sortedObjects: BoardObject[];
  /** Map of frameId → contained child objects (excludes nested frames) */
  objectsByFrame: Record<string, BoardObject[]>;
  /** Map of frameId → connectors where both endpoints are in the same frame */
  connectorsByFrame: Record<string, Connector[]>;
  /** Per-frame minimum resize dimensions based on largest contained child */
  frameMinSizes: Record<string, { minWidth: number; minHeight: number }>;
  /** Objects partitioned by type/containment for render */
  partitionedObjects: {
    uncontainedShapes: BoardObject[];
    uncontainedStickies: BoardObject[];
    frames: BoardObject[];
    lines: BoardObject[];
  };
}

export function useObjectPartitioning(
  objects: Record<string, BoardObject>,
  connectors: Record<string, Connector>
): UseObjectPartitioningReturn {
  // Fingerprint of id:zIndex pairs — cheap O(N) string build that only
  // changes when the object set or z-indices change (not on position updates).
  const zIndexKey = useMemo(() => {
    let key = "";
    for (const [id, obj] of Object.entries(objects)) {
      key += id + ":" + (obj.zIndex ?? 0) + "|";
    }
    return key;
  }, [objects]);

  // Stable sorted ID array — O(N log N) sort only when z-order actually changes.
  // Position-only drag updates leave zIndexKey unchanged so this is skipped.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedIds = useMemo(
    () =>
      Object.values(objects)
        .sort((a, b) => {
          const dz = (a.zIndex || 0) - (b.zIndex || 0);
          // Secondary key: object id (UUID). Deterministic on every client
          // regardless of realtime insertion order, so tied-zIndex objects
          // always render in the same order for all collaborators.
          return dz !== 0 ? dz : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        })
        .map((o) => o.id),
    // zIndexKey is the only dep — objects intentionally omitted so the
    // sort is skipped on position-only updates (drag echoes from Realtime).
    [zIndexKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Map sorted IDs to fresh object references — O(N) lookup, no sort.
  // Rebuilds on any objects change to ensure viewport culling uses current positions.
  const sortedObjects = useMemo(
    () => sortedIds.map((id) => objects[id]).filter((o): o is BoardObject => o !== undefined),
    [sortedIds, objects]
  );

  // Pre-computed map: frameId → contained objects (O(N) once, O(1) per lookup).
  const objectsByFrame = useMemo(() => {
    const map: Record<string, BoardObject[]> = {};
    for (const obj of Object.values(objects)) {
      if (obj.parentFrameId && obj.type !== "frame") {
        if (!map[obj.parentFrameId]) map[obj.parentFrameId] = [];
        map[obj.parentFrameId].push(obj);
      }
    }
    return map;
  }, [objects]);

  // Pre-computed map: frameId → intra-frame connectors (both endpoints in same frame).
  const connectorsByFrame = useMemo(() => {
    const map: Record<string, Connector[]> = {};
    for (const conn of Object.values(connectors)) {
      if (!conn.fromId || !conn.toId) continue;
      const fromFrame = objects[conn.fromId]?.parentFrameId;
      const toFrame = objects[conn.toId]?.parentFrameId;
      if (fromFrame && fromFrame === toFrame) {
        if (!map[fromFrame]) map[fromFrame] = [];
        map[fromFrame].push(conn);
      }
    }
    return map;
  }, [connectors, objects]);

  // Per-frame minimum resize dimensions based on the largest contained child.
  const frameMinSizes = useMemo(() => {
    const sizes: Record<string, { minWidth: number; minHeight: number }> = {};
    for (const [frameId, children] of Object.entries(objectsByFrame)) {
      const frameObj = objects[frameId];
      const titleHeight =
        frameObj && frameObj.type === "frame"
          ? getFrameHeaderHeight(frameObj)
          : DEFAULT_TITLE_HEIGHT;

      sizes[frameId] = minFrameSizeForChildren(
        children,
        titleHeight,
        FRAME_CONTENT_PADDING,
        MIN_FRAME_WIDTH,
        MIN_FRAME_HEIGHT
      );
    }
    return sizes;
  }, [objectsByFrame, objects]);

  // Single-pass partition of objects by type/containment for render.
  const partitionedObjects = useMemo(() => {
    const uncontainedShapes: BoardObject[] = [];
    const uncontainedStickies: BoardObject[] = [];
    const frames: BoardObject[] = [];
    const lines: BoardObject[] = [];

    for (const obj of sortedObjects) {
      if (obj.type === "frame") {
        frames.push(obj);
      } else if (obj.type === "line") {
        lines.push(obj);
      } else if (!obj.parentFrameId) {
        if (obj.type === "sticky") {
          uncontainedStickies.push(obj);
        } else if (obj.type === "rectangle" || obj.type === "circle") {
          uncontainedShapes.push(obj);
        }
      }
    }

    return { uncontainedShapes, uncontainedStickies, frames, lines };
  }, [sortedObjects]);

  return {
    sortedObjects,
    objectsByFrame,
    connectorsByFrame,
    frameMinSizes,
    partitionedObjects,
  };
}
