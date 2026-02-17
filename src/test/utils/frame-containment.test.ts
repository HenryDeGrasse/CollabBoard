import { describe, it, expect } from "vitest";
import {
  getContainedObjectIds,
  moveContainedObjects,
  getFrameBounds,
  pushRectOutsideFrame,
  constrainObjectOutsideFrames,
  getRectOverlapRatio,
  shouldPopOutFromFrame,
  isInsideFrameWithHysteresis,
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

describe("isInsideFrameWithHysteresis", () => {
  it("uses enter threshold when currently outside", () => {
    expect(isInsideFrameWithHysteresis(0.54, false, 0.55, 0.45)).toBe(false);
    expect(isInsideFrameWithHysteresis(0.55, false, 0.55, 0.45)).toBe(true);
  });

  it("uses exit threshold when currently inside", () => {
    expect(isInsideFrameWithHysteresis(0.46, true, 0.55, 0.45)).toBe(true);
    expect(isInsideFrameWithHysteresis(0.44, true, 0.55, 0.45)).toBe(false);
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
