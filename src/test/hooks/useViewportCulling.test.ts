import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useViewportCulling } from "../../hooks/useViewportCulling";
import type { BoardObject } from "../../types/board";

function makeObj(
  id: string,
  x: number,
  y: number,
  width = 150,
  height = 150,
  type: BoardObject["type"] = "sticky"
): BoardObject {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    color: "#FBBF24",
    rotation: 0,
    zIndex: 1,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const EMPTY_SET = new Set<string>();
const draggingRef = { current: EMPTY_SET };

describe("useViewportCulling", () => {
  const stageWidth = 1000;
  const stageHeight = 800;

  it("includes objects inside the viewport", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const stickies = [makeObj("s1", 100, 100)];

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: [],
        uncontainedStickies: stickies,
        frames: [],
        lines: [],
      }, draggingRef)
    );

    expect(result.current.visibleStickies).toHaveLength(1);
    expect(result.current.visibleStickies[0].id).toBe("s1");
  });

  it("excludes objects far outside the viewport", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    // Place object far to the right, well beyond viewport + cull margin
    const stickies = [makeObj("s1", 5000, 5000)];

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: [],
        uncontainedStickies: stickies,
        frames: [],
        lines: [],
      }, draggingRef)
    );

    expect(result.current.visibleStickies).toHaveLength(0);
  });

  it("includes objects within cull margin outside viewport edge", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    // Place object just past the right edge but within the 200px cull margin
    const stickies = [makeObj("s1", stageWidth + 100, 100)];

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: [],
        uncontainedStickies: stickies,
        frames: [],
        lines: [],
      }, draggingRef)
    );

    expect(result.current.visibleStickies).toHaveLength(1);
  });

  it("adjusts visible bounds when viewport is panned", () => {
    // Pan the viewport so the origin object is off-screen
    const viewport = { x: -3000, y: -3000, scale: 1 };
    const stickies = [
      makeObj("s1", 0, 0),       // now off-screen to the upper-left
      makeObj("s2", 3500, 3500), // now visible in the panned viewport
    ];

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: [],
        uncontainedStickies: stickies,
        frames: [],
        lines: [],
      }, draggingRef)
    );

    expect(result.current.visibleStickies.map((o) => o.id)).toEqual(["s2"]);
  });

  it("adjusts visible bounds when zoomed out", () => {
    // Zoomed out to 0.5 — visible area doubles
    const viewport = { x: 0, y: 0, scale: 0.5 };
    // Object at 1800 would be off-screen at scale=1, but visible at scale=0.5
    const stickies = [makeObj("s1", 1800, 400)];

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: [],
        uncontainedStickies: stickies,
        frames: [],
        lines: [],
      }, draggingRef)
    );

    expect(result.current.visibleStickies).toHaveLength(1);
  });

  it("always includes objects that are being dragged", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    // Object far outside viewport
    const stickies = [makeObj("s1", 9999, 9999)];
    const dragging = { current: new Set(["s1"]) };

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: [],
        uncontainedStickies: stickies,
        frames: [],
        lines: [],
      }, dragging)
    );

    expect(result.current.visibleStickies).toHaveLength(1);
  });

  it("filters each object type independently", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const shapes = [makeObj("shape1", 100, 100, 150, 150, "rectangle")];
    const stickies = [makeObj("s1", 100, 100)];
    const frames = [makeObj("f1", 9999, 9999, 400, 400, "frame")];

    const { result } = renderHook(() =>
      useViewportCulling(viewport, stageWidth, stageHeight, {
        uncontainedShapes: shapes,
        uncontainedStickies: stickies,
        frames,
        lines: [],
      }, draggingRef)
    );

    expect(result.current.visibleShapes).toHaveLength(1);
    expect(result.current.visibleStickies).toHaveLength(1);
    expect(result.current.visibleFrames).toHaveLength(0);
  });
});
