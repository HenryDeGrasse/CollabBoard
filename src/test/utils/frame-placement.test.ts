import { describe, it, expect } from "vitest";

// We test the logic directly — these are pure functions
// Duplicated from api/_lib/framePlacement.ts to test in vitest context
// (Vercel API files aren't processed by Vite)

const FRAME_TITLE_HEIGHT = 40;
const FRAME_PADDING = 20;
const OBJECT_GAP = 15;
const STICKY_SIZE = 150;

interface CompactObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentFrameId?: string | null;
}

interface FrameLayoutResult {
  objectX: number;
  objectY: number;
  frameExpansion?: { width: number; height: number };
}

function placeObjectInFrame(
  frame: CompactObject,
  existingChildren: CompactObject[],
  objectWidth: number = STICKY_SIZE,
  objectHeight: number = STICKY_SIZE,
  reserveExtraSlots: number = 1
): FrameLayoutResult {
  const contentLeft = frame.x + FRAME_PADDING;
  const contentTop = frame.y + FRAME_TITLE_HEIGHT + FRAME_PADDING;
  const contentWidth = frame.width - 2 * FRAME_PADDING;

  const cols = Math.max(
    1,
    Math.floor((contentWidth + OBJECT_GAP) / (objectWidth + OBJECT_GAP))
  );

  const occupiedCells = new Set<string>();
  for (const child of existingChildren) {
    const col = Math.round(
      (child.x - contentLeft) / (objectWidth + OBJECT_GAP)
    );
    const row = Math.round(
      (child.y - contentTop) / (objectHeight + OBJECT_GAP)
    );
    if (col >= 0 && col < cols && row >= 0) {
      occupiedCells.add(`${row},${col}`);
    }
  }

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

function calculateFrameSize(
  objectCount: number,
  objectWidth: number = STICKY_SIZE,
  objectHeight: number = STICKY_SIZE,
  maxCols: number = 4,
  reserveExtraSlots: number = 1
): { width: number; height: number } {
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

// ─── Tests ────────────────────────────────────────────────────

describe("placeObjectInFrame", () => {
  const makeFrame = (
    overrides: Partial<CompactObject> = {}
  ): CompactObject => ({
    id: "frame-1",
    type: "frame",
    x: 100,
    y: 100,
    width: 530, // fits 3 columns of stickies: 20 + 150 + 15 + 150 + 15 + 150 + 20 = 520
    height: 500,
    ...overrides,
  });

  it("places first object at top-left of content area", () => {
    const frame = makeFrame();
    const result = placeObjectInFrame(frame, []);

    expect(result.objectX).toBe(120); // frame.x + FRAME_PADDING
    expect(result.objectY).toBe(160); // frame.y + TITLE_HEIGHT + PADDING
  });

  it("places second object next to the first", () => {
    const frame = makeFrame();
    const child1: CompactObject = {
      id: "s1",
      type: "sticky",
      x: 120,
      y: 160,
      width: 150,
      height: 150,
    };
    const result = placeObjectInFrame(frame, [child1]);

    expect(result.objectX).toBe(120 + 150 + 15); // 285
    expect(result.objectY).toBe(160);
  });

  it("wraps to next row after filling columns", () => {
    const frame = makeFrame();
    // 3 columns fit in 530px frame. Fill all 3.
    const children: CompactObject[] = [
      { id: "s1", type: "sticky", x: 120, y: 160, width: 150, height: 150 },
      { id: "s2", type: "sticky", x: 285, y: 160, width: 150, height: 150 },
      { id: "s3", type: "sticky", x: 450, y: 160, width: 150, height: 150 },
    ];
    const result = placeObjectInFrame(frame, children);

    expect(result.objectX).toBe(120); // back to left
    expect(result.objectY).toBe(160 + 150 + 15); // 325, next row
  });

  it("requests frame expansion when objects exceed frame height", () => {
    // Small frame that fits only 1 row
    const frame = makeFrame({ height: 230 }); // TITLE(40) + PAD(20) + 150 + PAD(20) = 230
    const child1: CompactObject = {
      id: "s1",
      type: "sticky",
      x: 120,
      y: 160,
      width: 150,
      height: 150,
    };
    const child2: CompactObject = {
      id: "s2",
      type: "sticky",
      x: 285,
      y: 160,
      width: 150,
      height: 150,
    };
    const child3: CompactObject = {
      id: "s3",
      type: "sticky",
      x: 450,
      y: 160,
      width: 150,
      height: 150,
    };

    // Adding a 4th should need a 2nd row + reserve slot
    const result = placeObjectInFrame(frame, [child1, child2, child3]);

    expect(result.frameExpansion).toBeDefined();
    expect(result.frameExpansion!.height).toBeGreaterThan(230);
  });

  it("does NOT request expansion when frame has room", () => {
    const frame = makeFrame({ height: 600 });
    const result = placeObjectInFrame(frame, []);

    expect(result.frameExpansion).toBeUndefined();
  });

  it("reserves extra slot by default", () => {
    // Frame sized for exactly 2 objects in 1 row (2 cols)
    const frame = makeFrame({
      width: 355, // 20 + 150 + 15 + 150 + 20 = 355 (2 cols)
      height: 230, // 40 + 20 + 150 + 20 = 230 (1 row)
    });

    // Adding first sticky: needs room for 1 + 1 reserve = 2 slots = 1 row
    const result = placeObjectInFrame(frame, []);
    expect(result.frameExpansion).toBeUndefined(); // 2 slots fit in 1 row, frame is 1 row

    // Adding second sticky: needs room for 2 + 1 reserve = 3 slots = 2 rows
    const child1: CompactObject = {
      id: "s1",
      type: "sticky",
      x: 120,
      y: 160,
      width: 150,
      height: 150,
    };
    const result2 = placeObjectInFrame(frame, [child1]);
    expect(result2.frameExpansion).toBeDefined(); // needs 2nd row for reserve
  });
});

describe("calculateFrameSize", () => {
  it("calculates size for 1 object", () => {
    const size = calculateFrameSize(1);
    // 1 col, 2 rows (1 + 1 reserve)
    expect(size.width).toBe(20 + 150 + 20); // 190
    expect(size.height).toBe(40 + 20 + 150 + 15 + 150 + 20); // 395
  });

  it("calculates size for 4 objects (2x2 grid + reserve row)", () => {
    const size = calculateFrameSize(4);
    // 4 cols (maxCols=4), ceil(5/4)=2 rows
    expect(size.width).toBe(20 + 150 + 15 + 150 + 15 + 150 + 15 + 150 + 20); // 685
    expect(size.height).toBe(40 + 20 + 150 + 15 + 150 + 20); // 395
  });

  it("calculates size for 3 objects (3 cols, 1+reserve rows)", () => {
    const size = calculateFrameSize(3);
    // 3 cols, ceil(4/3)=2 rows
    expect(size.width).toBe(20 + 150 + 15 + 150 + 15 + 150 + 20); // 520
    expect(size.height).toBe(40 + 20 + 150 + 15 + 150 + 20); // 395
  });

  it("caps columns at maxCols", () => {
    const size = calculateFrameSize(8, 150, 150, 4);
    // 4 cols, ceil(9/4)=3 rows
    expect(size.width).toBe(685);
    expect(size.height).toBe(40 + 20 + 150 + 15 + 150 + 15 + 150 + 20); // 560
  });

  it("handles 0 objects (still reserves 1 slot)", () => {
    const size = calculateFrameSize(0);
    // 1 col (min), 1 row (for reserve)
    expect(size.width).toBe(190);
    expect(size.height).toBe(40 + 20 + 150 + 20); // 230
  });
});
