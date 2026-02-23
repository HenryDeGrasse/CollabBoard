import type { BoardObject } from "../types/board";
import { getOverlapRatio, rectContains, clampRectInside, rectsIntersect, type Rect } from "./geometry";

type RectLike = Rect;

export interface FrameGestureInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  clickThreshold: number;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
}

export interface FrameGestureResult {
  x: number;
  y: number;
  width: number;
  height: number;
  fromClick: boolean;
}

export function computeFrameFromGesture(input: FrameGestureInput): FrameGestureResult {
  const {
    startX,
    startY,
    endX,
    endY,
    clickThreshold,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
  } = input;

  const dx = endX - startX;
  const dy = endY - startY;

  const isClickLike = Math.abs(dx) < clickThreshold && Math.abs(dy) < clickThreshold;

  if (isClickLike) {
    return {
      x: startX - defaultWidth / 2,
      y: startY - defaultHeight / 2,
      width: defaultWidth,
      height: defaultHeight,
      fromClick: true,
    };
  }

  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.max(minWidth, Math.abs(dx)),
    height: Math.max(minHeight, Math.abs(dy)),
    fromClick: false,
  };
}

/**
 * Get IDs of non-frame objects that are spatially contained within a frame.
 * An object is "contained" if at least 50% of its area overlaps the frame.
 */
export function getContainedObjectIds(
  frame: BoardObject,
  objects: Record<string, BoardObject>
): string[] {
  return Object.values(objects)
    .filter((obj) => {
      // Don't include the frame itself or other frames
      if (obj.id === frame.id || obj.type === "frame") return false;
      // Object is contained if >= 50% of its area overlaps the frame
      return getOverlapRatio(obj, frame) >= 0.5;
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

  const containedObjects = containedIds
    .map((id) => objects[id])
    .filter((obj): obj is BoardObject => obj !== undefined);

  if (containedObjects.length === 0) return null;

  const bounds = containedObjects.reduce(
    (acc, obj) => ({
      minX: Math.min(acc.minX, obj.x),
      minY: Math.min(acc.minY, obj.y),
      maxX: Math.max(acc.maxX, obj.x + obj.width),
      maxY: Math.max(acc.maxY, obj.y + obj.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
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
  // If overlap is below threshold, don't snap
  if (getOverlapRatio(obj, frame) < snapThreshold) {
    return null;
  }

  // If already fully inside, no snap needed
  if (rectContains(frame, obj)) {
    return null;
  }

  // Snap to be fully inside
  return clampRectInside(obj, frame);
}

/**
 * Push children inward so they stay within a frame's content area during resize.
 *
 * The content area is the frame minus the title bar and an inner padding margin.
 * Only children whose positions actually change are returned.
 * If a child is larger than the content area on an axis it is pinned to the
 * top-left edge of that axis (combination of "enforce min size" + graceful fallback).
 */
export function constrainChildrenInFrame(
  frameBounds: { x: number; y: number; width: number; height: number },
  children: readonly { id: string; x: number; y: number; width: number; height: number }[],
  titleHeight: number,
  padding: number
): Record<string, { x: number; y: number }> {
  const contentLeft = frameBounds.x + padding;
  const contentTop = frameBounds.y + titleHeight + padding;
  const contentRight = frameBounds.x + frameBounds.width - padding;
  const contentBottom = frameBounds.y + frameBounds.height - padding;

  const updates: Record<string, { x: number; y: number }> = {};

  for (const child of children) {
    let newX = child.x;
    let newY = child.y;

    // Push from left edge
    if (newX < contentLeft) newX = contentLeft;
    // Push from right edge — but if child is wider than content area, pin to left
    if (newX + child.width > contentRight) {
      newX = contentRight - child.width;
      if (newX < contentLeft) newX = contentLeft;
    }

    // Push from top edge
    if (newY < contentTop) newY = contentTop;
    // Push from bottom edge — but if child is taller than content area, pin to top
    if (newY + child.height > contentBottom) {
      newY = contentBottom - child.height;
      if (newY < contentTop) newY = contentTop;
    }

    if (newX !== child.x || newY !== child.y) {
      updates[child.id] = { x: newX, y: newY };
    }
  }

  return updates;
}

/**
 * Compute the minimum frame dimensions that can still contain a set of children.
 * Accounts for title bar height and inner padding.
 */
export function minFrameSizeForChildren(
  children: readonly { width: number; height: number }[],
  titleHeight: number,
  padding: number,
  baseMinWidth: number,
  baseMinHeight: number
): { minWidth: number; minHeight: number } {
  let maxChildW = 0;
  let maxChildH = 0;
  for (const c of children) {
    if (c.width > maxChildW) maxChildW = c.width;
    if (c.height > maxChildH) maxChildH = c.height;
  }
  return {
    minWidth: Math.max(baseMinWidth, maxChildW + padding * 2),
    minHeight: Math.max(baseMinHeight, maxChildH + titleHeight + padding * 2),
  };
}

// Re-export for backwards compatibility
export { getOverlapRatio as getRectOverlapRatio } from "./geometry";

export function shouldPopOutFromFrame(
  rect: RectLike,
  frame: RectLike,
  popOutThreshold = 0.5
): boolean {
  return getOverlapRatio(rect, frame) < popOutThreshold;
}

/**
 * Push a rectangle to the closest non-overlapping position outside a frame.
 */
export function pushRectOutsideFrame(rect: RectLike, frame: RectLike): { x: number; y: number } {
  if (!rectsIntersect(rect, frame)) {
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

      if (rectsIntersect(current, frameRect)) {
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
