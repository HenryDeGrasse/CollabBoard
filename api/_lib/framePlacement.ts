import type { CompactObject } from "./boardState";

// ─── Constants ────────────────────────────────────────────────

export const FRAME_TITLE_HEIGHT = 40;
export const FRAME_PADDING = 20;
export const OBJECT_GAP = 15;
export const STICKY_SIZE = 150;

// ─── Types ────────────────────────────────────────────────────

export interface FrameLayoutResult {
  /** Where to place the new object */
  objectX: number;
  objectY: number;
  /** If set, the frame needs to grow to fit */
  frameExpansion?: { width: number; height: number };
}

export interface FrameSizeResult {
  width: number;
  height: number;
}

// ─── Place object inside a frame ──────────────────────────────

/**
 * Calculate the next available grid position for an object inside a frame.
 * Uses a row-first grid layout below the frame title.
 *
 * - Scans existing children to find occupied grid cells
 * - Places the new object in the next open cell
 * - Auto-expands the frame if needed (always reserves room for +1 extra object)
 *
 * @param frame            The parent frame object
 * @param existingChildren Objects already inside this frame
 * @param objectWidth      Width of the new object (default 150)
 * @param objectHeight     Height of the new object (default 150)
 * @param reserveExtraSlots Extra empty slots to ensure room for (default 1)
 */
export function placeObjectInFrame(
  frame: CompactObject,
  existingChildren: CompactObject[],
  objectWidth: number = STICKY_SIZE,
  objectHeight: number = STICKY_SIZE,
  reserveExtraSlots: number = 1
): FrameLayoutResult {
  const contentLeft = frame.x + FRAME_PADDING;
  const contentTop = frame.y + FRAME_TITLE_HEIGHT + FRAME_PADDING;
  const contentWidth = frame.width - 2 * FRAME_PADDING;

  // Grid columns that fit inside the frame
  const cols = Math.max(
    1,
    Math.floor((contentWidth + OBJECT_GAP) / (objectWidth + OBJECT_GAP))
  );

  // Build a set of occupied grid cells from existing children
  const occupiedCells = new Set<string>();
  for (const child of existingChildren) {
    // Map child position back to grid cell
    const col = Math.round((child.x - contentLeft) / (objectWidth + OBJECT_GAP));
    const row = Math.round((child.y - contentTop) / (objectHeight + OBJECT_GAP));
    if (col >= 0 && col < cols && row >= 0) {
      occupiedCells.add(`${row},${col}`);
    }
  }

  // Find first unoccupied cell
  let targetRow = 0;
  let targetCol = 0;
  const maxSearch = existingChildren.length + reserveExtraSlots + 1;
  for (let i = 0; i < maxSearch * cols; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (!occupiedCells.has(`${r},${c}`)) {
      targetRow = r;
      targetCol = c;
      break;
    }
  }

  const objectX = contentLeft + targetCol * (objectWidth + OBJECT_GAP);
  const objectY = contentTop + targetRow * (objectHeight + OBJECT_GAP);

  // Check if frame needs expansion
  const totalSlotsNeeded = existingChildren.length + 1 + reserveExtraSlots;
  const totalRows = Math.ceil(totalSlotsNeeded / cols);
  const neededHeight =
    FRAME_TITLE_HEIGHT +
    FRAME_PADDING * 2 +
    totalRows * (objectHeight + OBJECT_GAP) -
    OBJECT_GAP;

  let frameExpansion: { width: number; height: number } | undefined;
  if (neededHeight > frame.height) {
    frameExpansion = {
      width: frame.width,
      height: Math.max(frame.height, neededHeight),
    };
  }

  return { objectX, objectY, frameExpansion };
}

// ─── Calculate optimal frame size ─────────────────────────────

/**
 * Calculate the frame dimensions needed to hold N objects in a grid,
 * plus room for `reserveExtraSlots` more.
 *
 * Used when the AI creates a new frame and knows how many children it will add.
 *
 * @param objectCount       Number of objects the frame will contain
 * @param objectWidth       Width of each object (default 150)
 * @param objectHeight      Height of each object (default 150)
 * @param maxCols           Maximum columns (default 4)
 * @param reserveExtraSlots Extra empty slots to ensure room for (default 1)
 */
export function calculateFrameSize(
  objectCount: number,
  objectWidth: number = STICKY_SIZE,
  objectHeight: number = STICKY_SIZE,
  maxCols: number = 4,
  reserveExtraSlots: number = 1
): FrameSizeResult {
  const totalSlots = objectCount + reserveExtraSlots;
  const cols = Math.min(Math.max(1, objectCount), maxCols);
  const rows = Math.ceil(totalSlots / cols);

  const width =
    FRAME_PADDING * 2 + cols * (objectWidth + OBJECT_GAP) - OBJECT_GAP;
  const height =
    FRAME_TITLE_HEIGHT +
    FRAME_PADDING * 2 +
    rows * (objectHeight + OBJECT_GAP) -
    OBJECT_GAP;

  return { width, height };
}

// ─── Re-arrange children in a frame ───────────────────────────

/**
 * Compute new positions for all children to form a tidy grid
 * inside the frame. Returns a map of objectId → {x, y}.
 *
 * @param frame            The parent frame
 * @param children         Objects to arrange
 * @param objectWidth      Object width (default 150)
 * @param objectHeight     Object height (default 150)
 */
export function arrangeChildrenInGrid(
  frame: CompactObject,
  children: CompactObject[],
  objectWidth: number = STICKY_SIZE,
  objectHeight: number = STICKY_SIZE
): Record<string, { x: number; y: number }> {
  const contentLeft = frame.x + FRAME_PADDING;
  const contentTop = frame.y + FRAME_TITLE_HEIGHT + FRAME_PADDING;
  const contentWidth = frame.width - 2 * FRAME_PADDING;

  const cols = Math.max(
    1,
    Math.floor((contentWidth + OBJECT_GAP) / (objectWidth + OBJECT_GAP))
  );

  const positions: Record<string, { x: number; y: number }> = {};
  children.forEach((child, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    positions[child.id] = {
      x: contentLeft + col * (objectWidth + OBJECT_GAP),
      y: contentTop + row * (objectHeight + OBJECT_GAP),
    };
  });

  return positions;
}

/**
 * Compute the frame expansion needed to fit existing children
 * plus the reserve slots, given the current frame dimensions.
 */
export function computeFrameExpansionForChildren(
  frame: CompactObject,
  childCount: number,
  objectWidth: number = STICKY_SIZE,
  objectHeight: number = STICKY_SIZE,
  reserveExtraSlots: number = 1
): FrameSizeResult | null {
  const contentWidth = frame.width - 2 * FRAME_PADDING;
  const cols = Math.max(
    1,
    Math.floor((contentWidth + OBJECT_GAP) / (objectWidth + OBJECT_GAP))
  );

  const totalSlots = childCount + reserveExtraSlots;
  const totalRows = Math.ceil(totalSlots / cols);
  const neededHeight =
    FRAME_TITLE_HEIGHT +
    FRAME_PADDING * 2 +
    totalRows * (objectHeight + OBJECT_GAP) -
    OBJECT_GAP;

  if (neededHeight > frame.height) {
    return {
      width: frame.width,
      height: neededHeight,
    };
  }
  return null;
}
