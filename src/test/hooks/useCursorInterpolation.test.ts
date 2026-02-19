import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCursorInterpolation } from "../../hooks/useCursorInterpolation";

describe("useCursorInterpolation", () => {
  let rafCallbacks: ((time: number) => void)[];
  let rafId: number;
  let perfNow: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    perfNow = 0;

    vi.spyOn(performance, "now").mockImplementation(() => perfNow);
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: (time: number) => void) => {
      rafCallbacks.push(cb);
      return ++rafId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRAF(time: number) {
    perfNow = time;
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb(time));
  }

  it("returns empty array when rawCursors is empty", () => {
    const { result } = renderHook(() => useCursorInterpolation([]));
    expect(result.current).toEqual([]);
  });

  it("snaps to initial position on first cursor appearance", () => {
    perfNow = 100;
    const cursors = [{ id: "u1", displayName: "Alice", color: "#EF4444", x: 50, y: 75 }];
    const { result } = renderHook(() => useCursorInterpolation(cursors));

    // Should snap — no interpolation on first appearance
    expect(result.current[0].x).toBe(50);
    expect(result.current[0].y).toBe(75);
  });

  it("passes through displayName and color", () => {
    perfNow = 0;
    const cursors = [{ id: "u1", displayName: "Bob", color: "#3B82F6", x: 10, y: 20 }];
    const { result } = renderHook(() => useCursorInterpolation(cursors));

    expect(result.current[0].displayName).toBe("Bob");
    expect(result.current[0].color).toBe("#3B82F6");
    expect(result.current[0].id).toBe("u1");
  });

  it("handles cursor removal (departed users)", () => {
    perfNow = 0;
    const initial = [{ id: "u1", displayName: "Alice", color: "#EF4444", x: 10, y: 10 }];
    const { result, rerender } = renderHook(
      ({ cursors }) => useCursorInterpolation(cursors),
      { initialProps: { cursors: initial } }
    );

    expect(result.current.length).toBe(1);

    // Remove the cursor
    rerender({ cursors: [] });
    expect(result.current.length).toBe(0);
  });

  it("handles multiple cursors", () => {
    perfNow = 0;
    const cursors = [
      { id: "u1", displayName: "Alice", color: "#EF4444", x: 10, y: 10 },
      { id: "u2", displayName: "Bob", color: "#3B82F6", x: 100, y: 200 },
    ];
    const { result } = renderHook(() => useCursorInterpolation(cursors));

    expect(result.current.length).toBe(2);
    expect(result.current[0].id).toBe("u1");
    expect(result.current[1].id).toBe("u2");
  });

  it("skips update when position hasn't changed", () => {
    perfNow = 0;
    const cursors = [{ id: "u1", displayName: "Alice", color: "#EF4444", x: 50, y: 75 }];
    const { result, rerender } = renderHook(
      ({ c }) => useCursorInterpolation(c),
      { initialProps: { c: cursors } }
    );

    // Re-render with same position
    perfNow = 30;
    rerender({ c: [{ id: "u1", displayName: "Alice", color: "#EF4444", x: 50, y: 75 }] });

    // Position should remain the same (snapped)
    expect(result.current[0].x).toBe(50);
    expect(result.current[0].y).toBe(75);
  });

  it("starts interpolation on position update", () => {
    perfNow = 0;
    const initial = [{ id: "u1", displayName: "Alice", color: "#EF4444", x: 0, y: 0 }];
    const { result, rerender } = renderHook(
      ({ c }) => useCursorInterpolation(c),
      { initialProps: { c: initial } }
    );

    // Update position at t=30ms
    perfNow = 30;
    rerender({ c: [{ id: "u1", displayName: "Alice", color: "#EF4444", x: 100, y: 200 }] });

    // After rAF at the end of duration, position should be at target
    act(() => {
      flushRAF(60);
    });

    expect(result.current[0].x).toBe(100);
    expect(result.current[0].y).toBe(200);
  });
});
