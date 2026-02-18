import { describe, it, expect } from "vitest";
import {
  getContainedObjectIds,
  moveContainedObjects,
  getFrameBounds,
  pushRectOutsideFrame,
  constrainObjectOutsideFrames,
  getRectOverlapRatio,
  shouldPopOutFromFrame,
  constrainChildrenInFrame,
  minFrameSizeForChildren,
} from "../../utils/frame-containment";
import type { BoardObject } from "../../types/board";

function makeObj(id: string, x: number, y: number, w = 100, h = 100, type: BoardObject["type"] = "sticky"): BoardObject {
  return {
    id, type, x, y, width: w, height: h,
    color: "#fff", text: "", rotation: 0, zIndex: 1,
    createdBy: "u1", createdAt: 0, updatedAt: 0,
  };
}

describe("getContainedObjectIds", () => {
  it("returns objects fully inside the frame", () => {
    const frame = makeObj("frame1", 0, 0, 400, 400, "frame");
    const inside = makeObj("a", 50, 50, 100, 100);
    const outside = makeObj("b", 500, 500, 100, 100);
    const objects = { frame1: frame, a: inside, b: outside };

    const result = getContainedObjectIds(frame, objects);
    expect(result).toContain("a");
    expect(result).not.toContain("b");
    expect(result).not.toContain("frame1"); // frame doesn't contain itself
  });

  it("returns objects that overlap at least 50% with the frame", () => {
    const frame = makeObj("frame1", 0, 0, 400, 400, "frame");
    // Object mostly inside (75% overlap)
    const mostlyIn = makeObj("a", 300, 0, 200, 100);
    // Object mostly outside (25% overlap)
    const mostlyOut = makeObj("b", 350, 0, 200, 100);
    const objects = { frame1: frame, a: mostlyIn, b: mostlyOut };

    const result = getContainedObjectIds(frame, objects);
    expect(result).toContain("a");
    expect(result).not.toContain("b");
  });

  it("does not include other frames", () => {
    const frame = makeObj("frame1", 0, 0, 400, 400, "frame");
    const innerFrame = makeObj("frame2", 50, 50, 200, 200, "frame");
    const sticky = makeObj("a", 60, 60, 80, 80);
    const objects = { frame1: frame, frame2: innerFrame, a: sticky };

    const result = getContainedObjectIds(frame, objects);
    expect(result).toContain("a");
    expect(result).not.toContain("frame2"); // no nested frames
  });
});

describe("moveContainedObjects", () => {
  it("returns position updates with the same delta as the frame move", () => {
    const containedIds = ["a", "b"];
    const objects: Record<string, BoardObject> = {
      a: makeObj("a", 50, 50),
      b: makeObj("b", 200, 100),
    };
    const dx = 30;
    const dy = -20;

    const updates = moveContainedObjects(containedIds, objects, dx, dy);
    expect(updates).toEqual({
      a: { x: 80, y: 30 },
      b: { x: 230, y: 80 },
    });
  });
});

describe("getFrameBounds", () => {
  it("returns the bounding box of contained objects plus padding", () => {
    const objects: Record<string, BoardObject> = {
      a: makeObj("a", 50, 50, 100, 100),
      b: makeObj("b", 200, 200, 100, 100),
    };

    const bounds = getFrameBounds(["a", "b"], objects, 20);
    // Min x = 50 - 20 = 30, Min y = 50 - 20 = 30
    // Max x = 300 + 20 = 320, Max y = 300 + 20 = 320
    expect(bounds).toEqual({ x: 30, y: 30, width: 290, height: 290 });
  });

  it("returns null for empty contained ids", () => {
    expect(getFrameBounds([], {}, 20)).toBeNull();
  });
});

describe("pushRectOutsideFrame", () => {
  it("pushes object to the nearest outside edge", () => {
    const rect = { x: 90, y: 120, width: 40, height: 40 };
    const frame = { x: 100, y: 100, width: 200, height: 200 };

    // Closest valid non-overlapping position is immediately left of frame.
    expect(pushRectOutsideFrame(rect, frame)).toEqual({ x: 60, y: 120 });
  });

  it("returns same position if there is no overlap", () => {
    const rect = { x: 20, y: 20, width: 40, height: 40 };
    const frame = { x: 100, y: 100, width: 200, height: 200 };
    expect(pushRectOutsideFrame(rect, frame)).toEqual({ x: 20, y: 20 });
  });
});

describe("overlap ratio + pop-out", () => {
  it("computes overlap ratio of object area inside frame", () => {
    const frame = { x: 100, y: 100, width: 200, height: 200 };
    const rectHalf = { x: 250, y: 120, width: 100, height: 100 }; // 50% inside

    expect(getRectOverlapRatio(rectHalf, frame)).toBeCloseTo(0.5, 5);
    expect(shouldPopOutFromFrame(rectHalf, frame, 0.5)).toBe(false);
  });

  it("pops out when overlap drops below 50%", () => {
    const frame = { x: 100, y: 100, width: 200, height: 200 };
    const rectLessThanHalf = { x: 260, y: 120, width: 100, height: 100 }; // 40% inside

    expect(getRectOverlapRatio(rectLessThanHalf, frame)).toBeCloseTo(0.4, 5);
    expect(shouldPopOutFromFrame(rectLessThanHalf, frame, 0.5)).toBe(true);
  });
});

describe("constrainObjectOutsideFrames", () => {
  it("keeps object outside frame when overlap occurs", () => {
    const frame = makeObj("frame1", 100, 100, 200, 200, "frame");
    const constrained = constrainObjectOutsideFrames(
      { x: 90, y: 140, width: 60, height: 60 },
      [frame],
      null
    );

    // Should be pushed flush to frame's left edge.
    expect(constrained).toEqual({ x: 40, y: 140 });
  });

  it("allows overlap when cursor is inside that frame", () => {
    const frame = makeObj("frame1", 100, 100, 200, 200, "frame");
    const constrained = constrainObjectOutsideFrames(
      { x: 120, y: 140, width: 60, height: 60 },
      [frame],
      "frame1"
    );

    // No push if this frame is currently allowed.
    expect(constrained).toEqual({ x: 120, y: 140 });
  });
});

describe("constrainChildrenInFrame", () => {
  const TITLE = 32;
  const PAD = 6;

  it("returns empty when all children are inside", () => {
    const frame = { x: 0, y: 0, width: 400, height: 400 };
    const children = [
      { id: "a", x: 20, y: 50, width: 100, height: 100 },
    ];
    expect(constrainChildrenInFrame(frame, children, TITLE, PAD)).toEqual({});
  });

  it("pushes child inward when left edge contracts past it", () => {
    // Frame shrunk from left — new x is 100, child was at x=50
    const frame = { x: 100, y: 0, width: 300, height: 400 };
    const children = [
      { id: "a", x: 50, y: 50, width: 80, height: 80 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(result.a).toBeDefined();
    expect(result.a.x).toBe(100 + PAD); // pushed to content left
    expect(result.a.y).toBe(50); // y unchanged
  });

  it("pushes child inward when right edge contracts past it", () => {
    const frame = { x: 0, y: 0, width: 200, height: 400 };
    // Child right edge is at 250, frame right is 200
    const children = [
      { id: "a", x: 150, y: 50, width: 100, height: 80 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(result.a).toBeDefined();
    expect(result.a.x).toBe(200 - PAD - 100); // pushed to content right - child width
  });

  it("pushes child inward when top edge contracts past it", () => {
    const frame = { x: 0, y: 100, width: 400, height: 300 };
    // Child y=110 is above content top (frame.y + title + pad = 100+32+6 = 138)
    const children = [
      { id: "a", x: 50, y: 110, width: 80, height: 80 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(result.a).toBeDefined();
    expect(result.a.y).toBe(100 + TITLE + PAD);
  });

  it("pushes child inward when bottom edge contracts past it", () => {
    const frame = { x: 0, y: 0, width: 400, height: 200 };
    // Child bottom edge is at 270, frame bottom - pad = 194
    const children = [
      { id: "a", x: 50, y: 190, width: 80, height: 80 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(result.a).toBeDefined();
    expect(result.a.y).toBe(200 - PAD - 80);
  });

  it("pins child to top-left if larger than content area", () => {
    // Frame is 150x120, content area is only 150-12=138 wide, 120-32-12=76 tall
    const frame = { x: 0, y: 0, width: 150, height: 120 };
    const children = [
      { id: "big", x: -10, y: -10, width: 200, height: 200 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(result.big).toBeDefined();
    expect(result.big.x).toBe(PAD); // pinned to content left
    expect(result.big.y).toBe(TITLE + PAD); // pinned to content top
  });

  it("handles simultaneous push on two edges (corner resize)", () => {
    const frame = { x: 50, y: 50, width: 200, height: 200 };
    // Child in top-left corner, partially outside both left and top
    const children = [
      { id: "a", x: 40, y: 60, width: 80, height: 80 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(result.a).toBeDefined();
    expect(result.a.x).toBe(50 + PAD); // pushed from left
    expect(result.a.y).toBe(50 + TITLE + PAD); // pushed from top
  });

  it("does not move children already safely inside", () => {
    const frame = { x: 0, y: 0, width: 400, height: 400 };
    const children = [
      { id: "a", x: 100, y: 100, width: 80, height: 80 },
      { id: "b", x: 200, y: 200, width: 60, height: 60 },
    ];
    const result = constrainChildrenInFrame(frame, children, TITLE, PAD);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("minFrameSizeForChildren", () => {
  const TITLE = 32;
  const PAD = 6;

  it("returns base minimums when there are no children", () => {
    const result = minFrameSizeForChildren([], TITLE, PAD, 200, 150);
    expect(result).toEqual({ minWidth: 200, minHeight: 150 });
  });

  it("returns base minimums when children are smaller", () => {
    const children = [{ width: 80, height: 60 }];
    const result = minFrameSizeForChildren(children, TITLE, PAD, 200, 150);
    // 80 + 12 = 92 < 200, 60 + 32 + 12 = 104 < 150
    expect(result).toEqual({ minWidth: 200, minHeight: 150 });
  });

  it("increases minimum when a child is wider than base min", () => {
    const children = [{ width: 250, height: 60 }];
    const result = minFrameSizeForChildren(children, TITLE, PAD, 200, 150);
    expect(result.minWidth).toBe(250 + PAD * 2); // 262
    expect(result.minHeight).toBe(150); // base still larger
  });

  it("increases minimum when a child is taller than base min", () => {
    const children = [{ width: 80, height: 200 }];
    const result = minFrameSizeForChildren(children, TITLE, PAD, 200, 150);
    expect(result.minWidth).toBe(200); // base still larger
    expect(result.minHeight).toBe(200 + TITLE + PAD * 2); // 244
  });

  it("picks the largest child for each axis", () => {
    const children = [
      { width: 300, height: 50 },
      { width: 100, height: 250 },
    ];
    const result = minFrameSizeForChildren(children, TITLE, PAD, 200, 150);
    expect(result.minWidth).toBe(300 + PAD * 2); // 312
    expect(result.minHeight).toBe(250 + TITLE + PAD * 2); // 294
  });
});
