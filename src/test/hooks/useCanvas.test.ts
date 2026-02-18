import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvas } from "../../hooks/useCanvas";

describe("useCanvas hook", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with default viewport", () => {
    const { result } = renderHook(() => useCanvas());

    expect(result.current.viewport).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it("loads saved viewport for a board from localStorage", () => {
    localStorage.setItem(
      "collabboard:viewport:board-1",
      JSON.stringify({ x: 120, y: -60, scale: 1.5 })
    );

    const { result } = renderHook(() => useCanvas("board-1"));

    expect(result.current.viewport).toEqual({
      x: 120,
      y: -60,
      scale: 1.5,
    });
  });

  it("ignores corrupt saved viewport data", () => {
    localStorage.setItem("collabboard:viewport:board-1", JSON.stringify({ x: "bad", y: 10, scale: 1 }));

    const { result } = renderHook(() => useCanvas("board-1"));

    expect(result.current.viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("setViewport updates the viewport", () => {
    const { result } = renderHook(() => useCanvas());

    act(() => {
      result.current.setViewport({ x: 100, y: 200, scale: 1.5 });
    });

    expect(result.current.viewport).toEqual({
      x: 100,
      y: 200,
      scale: 1.5,
    });
  });

  it("setViewport works with updater function", () => {
    const { result } = renderHook(() => useCanvas());

    act(() => {
      result.current.setViewport({ x: 50, y: 50, scale: 1 });
    });
    act(() => {
      result.current.setViewport((prev) => ({
        ...prev,
        x: prev.x + 100,
      }));
    });

    expect(result.current.viewport.x).toBe(150);
    expect(result.current.viewport.y).toBe(50);
  });

  it("debounces viewport persistence to localStorage", () => {
    vi.useFakeTimers();
    const key = "collabboard:viewport:board-2";

    const { result } = renderHook(() => useCanvas("board-2"));

    act(() => {
      result.current.setViewport({ x: 240, y: 360, scale: 1.8 });
    });

    // Not saved yet (debounced 300ms)
    expect(localStorage.getItem(key)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(localStorage.getItem(key)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(JSON.parse(localStorage.getItem(key) || "null")).toEqual({
      x: 240,
      y: 360,
      scale: 1.8,
    });
  });

  it("flushes latest viewport on unmount", () => {
    vi.useFakeTimers();
    const key = "collabboard:viewport:board-3";

    const { result, unmount } = renderHook(() => useCanvas("board-3"));

    act(() => {
      result.current.setViewport({ x: -20, y: 75, scale: 2 });
    });

    // Before debounce expires, no persisted value yet.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(localStorage.getItem(key)).toBeNull();

    // Unmount should force a flush.
    unmount();

    expect(JSON.parse(localStorage.getItem(key) || "null")).toEqual({
      x: -20,
      y: 75,
      scale: 2,
    });
  });

  it("provides a stageRef", () => {
    const { result } = renderHook(() => useCanvas());
    expect(result.current.stageRef).toBeDefined();
    expect(result.current.stageRef.current).toBeNull();
  });

  it("provides an onWheel handler", () => {
    const { result } = renderHook(() => useCanvas());
    expect(typeof result.current.onWheel).toBe("function");
  });
});
