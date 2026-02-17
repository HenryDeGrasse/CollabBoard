import type { BoardObject } from "../types/board";

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
