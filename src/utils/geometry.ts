/**
 * Shared geometry utilities for rectangle and point calculations.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get the center point of a rectangle.
 */
export function getRectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Calculate the overlap area between two rectangles.
 * Returns 0 if rectangles don't overlap.
 */
export function calculateOverlapArea(rect1: Rect, rect2: Rect): number {
  const overlapX = Math.max(
    0,
    Math.min(rect1.x + rect1.width, rect2.x + rect2.width) -
      Math.max(rect1.x, rect2.x)
  );
  const overlapY = Math.max(
    0,
    Math.min(rect1.y + rect1.height, rect2.y + rect2.height) -
      Math.max(rect1.y, rect2.y)
  );
  return overlapX * overlapY;
}

/**
 * Calculate what fraction of rect1's area overlaps with rect2.
 * Returns a value between 0 and 1.
 */
export function getOverlapRatio(rect1: Rect, rect2: Rect): number {
  const rect1Area = rect1.width * rect1.height;
  if (rect1Area <= 0) return 0;
  return calculateOverlapArea(rect1, rect2) / rect1Area;
}

/**
 * Check if two rectangles intersect (have any overlap).
 */
export function rectsIntersect(rect1: Rect, rect2: Rect): boolean {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

/**
 * Check if inner rect is fully contained within outer rect.
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Clamp a rect to be fully inside a container rect.
 * Returns the adjusted position (x, y).
 */
export function clampRectInside(
  rect: Rect,
  container: Rect
): Point {
  let x = rect.x;
  let y = rect.y;

  if (x < container.x) x = container.x;
  if (y < container.y) y = container.y;
  if (x + rect.width > container.x + container.width) {
    x = container.x + container.width - rect.width;
  }
  if (y + rect.height > container.y + container.height) {
    y = container.y + container.height - rect.height;
  }

  return { x, y };
}
