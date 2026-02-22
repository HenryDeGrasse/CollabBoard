import { describe, it, expect } from "vitest";
import {
  getRectCenter,
  calculateOverlapArea,
  getOverlapRatio,
  rectsIntersect,
  rectContains,
  clampRectInside,
} from "../../utils/geometry";

describe("getRectCenter", () => {
  it("returns center of a rectangle", () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(getRectCenter(rect)).toEqual({ x: 50, y: 25 });
  });

  it("handles offset rectangles", () => {
    const rect = { x: 100, y: 200, width: 40, height: 60 };
    expect(getRectCenter(rect)).toEqual({ x: 120, y: 230 });
  });
});

describe("calculateOverlapArea", () => {
  it("returns 0 for non-overlapping rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 };
    const rect2 = { x: 20, y: 20, width: 10, height: 10 };
    expect(calculateOverlapArea(rect1, rect2)).toBe(0);
  });

  it("calculates overlap for partially overlapping rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 };
    const rect2 = { x: 5, y: 5, width: 10, height: 10 };
    expect(calculateOverlapArea(rect1, rect2)).toBe(25); // 5x5 overlap
  });

  it("calculates overlap when one contains the other", () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 25, y: 25, width: 50, height: 50 };
    expect(calculateOverlapArea(outer, inner)).toBe(2500); // 50x50
  });
});

describe("getOverlapRatio", () => {
  it("returns 0 for non-overlapping rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 };
    const rect2 = { x: 100, y: 100, width: 10, height: 10 };
    expect(getOverlapRatio(rect1, rect2)).toBe(0);
  });

  it("returns 1 when rect1 is fully inside rect2", () => {
    const inner = { x: 25, y: 25, width: 50, height: 50 };
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(getOverlapRatio(inner, outer)).toBe(1);
  });

  it("returns partial overlap ratio", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 }; // area = 100
    const rect2 = { x: 5, y: 5, width: 10, height: 10 }; // 5x5 = 25 overlap
    expect(getOverlapRatio(rect1, rect2)).toBe(0.25);
  });

  it("returns 0 for zero-area rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 0, height: 10 };
    const rect2 = { x: 0, y: 0, width: 10, height: 10 };
    expect(getOverlapRatio(rect1, rect2)).toBe(0);
  });
});

describe("rectsIntersect", () => {
  it("returns true for overlapping rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 };
    const rect2 = { x: 5, y: 5, width: 10, height: 10 };
    expect(rectsIntersect(rect1, rect2)).toBe(true);
  });

  it("returns false for non-overlapping rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 };
    const rect2 = { x: 20, y: 20, width: 10, height: 10 };
    expect(rectsIntersect(rect1, rect2)).toBe(false);
  });

  it("returns false for touching but not overlapping rectangles", () => {
    const rect1 = { x: 0, y: 0, width: 10, height: 10 };
    const rect2 = { x: 10, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(rect1, rect2)).toBe(false);
  });
});

describe("rectContains", () => {
  it("returns true when inner is fully inside outer", () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 25, y: 25, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it("returns false when inner extends outside outer", () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 50, y: 50, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it("returns true when inner touches outer edges", () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectContains(outer, inner)).toBe(true);
  });
});

describe("clampRectInside", () => {
  it("returns same position when already inside", () => {
    const rect = { x: 25, y: 25, width: 50, height: 50 };
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampRectInside(rect, container)).toEqual({ x: 25, y: 25 });
  });

  it("clamps rect extending past right edge", () => {
    const rect = { x: 80, y: 25, width: 50, height: 50 };
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampRectInside(rect, container)).toEqual({ x: 50, y: 25 });
  });

  it("clamps rect extending past left edge", () => {
    const rect = { x: -20, y: 25, width: 50, height: 50 };
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampRectInside(rect, container)).toEqual({ x: 0, y: 25 });
  });

  it("clamps rect extending past bottom edge", () => {
    const rect = { x: 25, y: 80, width: 50, height: 50 };
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampRectInside(rect, container)).toEqual({ x: 25, y: 50 });
  });

  it("clamps rect extending past top edge", () => {
    const rect = { x: 25, y: -20, width: 50, height: 50 };
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(clampRectInside(rect, container)).toEqual({ x: 25, y: 0 });
  });
});
