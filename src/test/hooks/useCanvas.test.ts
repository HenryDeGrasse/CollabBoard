import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvas } from "../../hooks/useCanvas";

describe("useCanvas hook", () => {
  it("initializes with default viewport", () => {
    const { result } = renderHook(() => useCanvas());

    expect(result.current.viewport).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
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
