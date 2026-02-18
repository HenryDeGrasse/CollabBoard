import type { CompactObject, Viewport } from "./boardState.js";

/**
 * Find a non-overlapping position for a new object near the desired location.
 * Uses a spiral/grid search outward from (desiredX, desiredY).
 *
 * @param desiredX  Starting X (usually viewport center or AI-chosen)
 * @param desiredY  Starting Y
 * @param w         Object width
 * @param h         Object height
 * @param viewport  Current viewport bounds
 * @param existing  Existing objects to avoid overlapping
 * @param padding   Gap between objects (default 20px)
 * @returns         { x, y } — resolved non-overlapping position
 */
export function resolvePlacement(
  desiredX: number,
  desiredY: number,
  w: number,
  h: number,
  viewport: Viewport,
  existing: CompactObject[],
  padding: number = 20
): { x: number; y: number } {
  const step = 40;
  const maxRadius = 1200;

  // Check if a rectangle overlaps any existing object
  const overlaps = (x: number, y: number): boolean => {
    for (const obj of existing) {
      if (
        x < obj.x + obj.width + padding &&
        x + w + padding > obj.x &&
        y < obj.y + obj.height + padding &&
        y + h + padding > obj.y
      ) {
        return true;
      }
    }
    return false;
  };

  // Try desired position first
  if (!overlaps(desiredX, desiredY)) {
    return clampToViewport(desiredX, desiredY, w, h, viewport);
  }

  // Spiral search outward
  for (let radius = step; radius <= maxRadius; radius += step) {
    // Check 8 directions at each radius
    const offsets = [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius, radius],
      [-radius, radius],
      [radius, -radius],
      [-radius, -radius],
    ];

    for (const [dx, dy] of offsets) {
      const cx = desiredX + dx;
      const cy = desiredY + dy;
      if (!overlaps(cx, cy)) {
        return clampToViewport(cx, cy, w, h, viewport);
      }
    }
  }

  // Fallback: offset from desired position (beyond max radius)
  return clampToViewport(desiredX + maxRadius + step, desiredY, w, h, viewport);
}

/**
 * Clamp position to a reasonable range near the viewport.
 * Allow some overflow (2x viewport dimensions) but prevent extreme coordinates.
 */
function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  viewport: Viewport
): { x: number; y: number } {
  const vWidth = viewport.maxX - viewport.minX;
  const vHeight = viewport.maxY - viewport.minY;
  const margin = Math.max(vWidth, vHeight) * 2;

  const clampedX = Math.max(viewport.minX - margin, Math.min(x, viewport.maxX + margin - w));
  const clampedY = Math.max(viewport.minY - margin, Math.min(y, viewport.maxY + margin - h));

  return { x: clampedX, y: clampedY };
}

/**
 * Clamp a numeric value to sane min/max bounds.
 */
export function clampValue(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(val, max));
}

// Object size constraints
export const SIZE_MIN = 50;
export const SIZE_MAX = 2000;
export const COORD_MIN = -50000;
export const COORD_MAX = 50000;
export const TEXT_MAX_LENGTH = 500;
