import type { BoardObject } from "../types/board";

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get IDs of non-frame objects that are spatially contained within a frame.
 * An object is "contained" if at least 50% of its area overlaps the frame.
 */
export function getContainedObjectIds(
  frame: BoardObject,
  objects: Record<string, BoardObject>
): string[] {
  const fx = frame.x;
  const fy = frame.y;
  const fw = frame.width;
  const fh = frame.height;

  return Object.values(objects)
    .filter((obj) => {
      // Don't include the frame itself or other frames
      if (obj.id === frame.id || obj.type === "frame") return false;

      // Calculate overlap area
      const overlapX = Math.max(0, Math.min(fx + fw, obj.x + obj.width) - Math.max(fx, obj.x));
      const overlapY = Math.max(0, Math.min(fy + fh, obj.y + obj.height) - Math.max(fy, obj.y));
      const overlapArea = overlapX * overlapY;
      const objArea = obj.width * obj.height;

      // Object is contained if >= 50% of its area overlaps the frame
      return objArea > 0 && overlapArea / objArea >= 0.5;
    })
    .map((obj) => obj.id);
}

/**
 * Calculate new positions for contained objects after a frame move.
 * Returns a map of objectId → { x, y }.
 */
export function moveContainedObjects(
  containedIds: string[],
  objects: Record<string, BoardObject>,
  dx: number,
  dy: number
): Record<string, { x: number; y: number }> {
  const updates: Record<string, { x: number; y: number }> = {};
  for (const id of containedIds) {
    const obj = objects[id];
    if (obj) {
      updates[id] = { x: obj.x + dx, y: obj.y + dy };
    }
  }
  return updates;
}

/**
 * Get a bounding box that fits all contained objects plus padding.
 * Used for auto-expanding a frame when objects are added.
 */
export function getFrameBounds(
  containedIds: string[],
  objects: Record<string, BoardObject>,
  padding: number
): { x: number; y: number; width: number; height: number } | null {
  if (containedIds.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const id of containedIds) {
    const obj = objects[id];
    if (!obj) continue;
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.width);
    maxY = Math.max(maxY, obj.y + obj.height);
  }

  if (!isFinite(minX)) return null;

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * Snap an object to be fully inside a frame if it's mostly inside already.
 * Returns the snapped position, or null if no snap needed.
 */
export function snapToFrame(
  obj: BoardObject,
  frame: BoardObject,
  snapThreshold = 0.3
): { x: number; y: number } | null {
  const fx = frame.x;
  const fy = frame.y;
  const fw = frame.width;
  const fh = frame.height;

  // Calculate overlap
  const overlapX = Math.max(0, Math.min(fx + fw, obj.x + obj.width) - Math.max(fx, obj.x));
  const overlapY = Math.max(0, Math.min(fy + fh, obj.y + obj.height) - Math.max(fy, obj.y));
  const overlapArea = overlapX * overlapY;
  const objArea = obj.width * obj.height;

  // If < 30% overlap, don't snap
  if (objArea === 0 || overlapArea / objArea < snapThreshold) {
    return null;
  }

  // If already fully inside, no snap needed
  if (obj.x >= fx && obj.y >= fy && obj.x + obj.width <= fx + fw && obj.y + obj.height <= fy + fh) {
    return null;
  }

  // Snap to be fully inside
  let newX = obj.x;
  let newY = obj.y;

  if (obj.x < fx) newX = fx;
  if (obj.y < fy) newY = fy;
  if (obj.x + obj.width > fx + fw) newX = fx + fw - obj.width;
  if (obj.y + obj.height > fy + fh) newY = fy + fh - obj.height;

  return { x: newX, y: newY };
}

function intersects(a: RectLike, b: RectLike): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getRectOverlapRatio(rect: RectLike, frame: RectLike): number {
  const overlapX = Math.max(0, Math.min(rect.x + rect.width, frame.x + frame.width) - Math.max(rect.x, frame.x));
  const overlapY = Math.max(0, Math.min(rect.y + rect.height, frame.y + frame.height) - Math.max(rect.y, frame.y));
  const overlapArea = overlapX * overlapY;
  const rectArea = rect.width * rect.height;
  if (rectArea <= 0) return 0;
  return overlapArea / rectArea;
}

export function shouldPopOutFromFrame(
  rect: RectLike,
  frame: RectLike,
  popOutThreshold = 0.5
): boolean {
  return getRectOverlapRatio(rect, frame) < popOutThreshold;
}

/**
 * Push a rectangle to the closest non-overlapping position outside a frame.
 */
export function pushRectOutsideFrame(rect: RectLike, frame: RectLike): { x: number; y: number } {
  if (!intersects(rect, frame)) {
    return { x: rect.x, y: rect.y };
  }

  const pushLeft = Math.abs((frame.x - rect.width) - rect.x);
  const pushRight = Math.abs((frame.x + frame.width) - rect.x);
  const pushUp = Math.abs((frame.y - rect.height) - rect.y);
  const pushDown = Math.abs((frame.y + frame.height) - rect.y);

  const min = Math.min(pushLeft, pushRight, pushUp, pushDown);

  if (min === pushLeft) {
    return { x: frame.x - rect.width, y: rect.y };
  }
  if (min === pushRight) {
    return { x: frame.x + frame.width, y: rect.y };
  }
  if (min === pushUp) {
    return { x: rect.x, y: frame.y - rect.height };
  }
  return { x: rect.x, y: frame.y + frame.height };
}

/**
 * Prevent objects from overlapping frame boundaries unless cursor is inside the frame.
 *
 * If allowInsideFrameId is provided, overlap is allowed with that frame only.
 */
export function constrainObjectOutsideFrames(
  rect: RectLike,
  frames: BoardObject[],
  allowInsideFrameId: string | null = null
): { x: number; y: number } {
  let current = { ...rect };

  // Iterate a few times to resolve overlaps against multiple frames.
  for (let i = 0; i < 4; i++) {
    let changed = false;

    for (const frame of frames) {
      if (frame.id === allowInsideFrameId) continue;

      const frameRect: RectLike = {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      };

      if (intersects(current, frameRect)) {
        const pushed = pushRectOutsideFrame(current, frameRect);
        if (pushed.x !== current.x || pushed.y !== current.y) {
          current = { ...current, x: pushed.x, y: pushed.y };
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return { x: current.x, y: current.y };
}
