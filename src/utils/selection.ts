import type { BoardObject, Connector } from "../types/board";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Returns IDs of objects that intersect (overlap) the selection rectangle.
 */
export function getObjectIdsInRect(
  objects: Record<string, BoardObject>,
  rect: SelectionRect
): string[] {
  return Object.values(objects)
    .filter(
      (obj) =>
        obj.x < rect.x + rect.width &&
        obj.x + obj.width > rect.x &&
        obj.y < rect.y + rect.height &&
        obj.y + obj.height > rect.y
    )
    .map((obj) => obj.id);
}

/**
 * Returns IDs of connectors whose visual line segment intersects the selection rectangle.
 * A connector's segment runs between the centers of its fromObj and toObj.
 * We check if the segment intersects the rect (not just both endpoints inside it).
 */
export function getConnectorIdsInRect(
  connectors: Record<string, Connector>,
  objects: Record<string, BoardObject>,
  rect: SelectionRect
): string[] {
  return Object.values(connectors)
    .filter((conn) => {
      const fromObj = objects[conn.fromId];
      const toObj = objects[conn.toId];
      if (!fromObj || !toObj) return false;

      const x1 = fromObj.x + fromObj.width / 2;
      const y1 = fromObj.y + fromObj.height / 2;
      const x2 = toObj.x + toObj.width / 2;
      const y2 = toObj.y + toObj.height / 2;

      return lineSegmentIntersectsRect(x1, y1, x2, y2, rect);
    })
    .map((c) => c.id);
}

/**
 * Check if a line segment (x1,y1)→(x2,y2) intersects a rectangle.
 * Uses: endpoint-in-rect check + line-crosses-edge check.
 */
export function lineSegmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: SelectionRect
): boolean {
  const rx = rect.x;
  const ry = rect.y;
  const rw = rect.width;
  const rh = rect.height;

  // If either endpoint is inside the rect, it intersects
  if (pointInRect(x1, y1, rx, ry, rw, rh) || pointInRect(x2, y2, rx, ry, rw, rh)) {
    return true;
  }

  // Check if line segment crosses any of the 4 rect edges
  return (
    segmentsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry) || // top
    segmentsIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh) || // bottom
    segmentsIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh) || // left
    segmentsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) // right
  );
}

function pointInRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * Check if two line segments (a1→a2) and (b1→b2) intersect.
 */
function segmentsIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number
): boolean {
  const d1 = cross(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = cross(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = cross(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = cross(ax1, ay1, ax2, ay2, bx2, by2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear cases
  if (d1 === 0 && onSegment(bx1, by1, bx2, by2, ax1, ay1)) return true;
  if (d2 === 0 && onSegment(bx1, by1, bx2, by2, ax2, ay2)) return true;
  if (d3 === 0 && onSegment(ax1, ay1, ax2, ay2, bx1, by1)) return true;
  if (d4 === 0 && onSegment(ax1, ay1, ax2, ay2, bx2, by2)) return true;

  return false;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return (
    Math.min(ax, bx) <= px && px <= Math.max(ax, bx) &&
    Math.min(ay, by) <= py && py <= Math.max(ay, by)
  );
}
