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

  // ── RAF-batched zoom tests ──────────────────────────────────────────

  describe("onWheel RAF batching", () => {
    let rafCallbacks: ((time: number) => void)[];
    let rafId: number;

    function makeMockStage(scale = 1, x = 0, y = 0) {
      let _x = x, _y = y, _scaleX = scale, _scaleY = scale;
      const stage: any = {
        scaleX: (v?: number) => { if (v !== undefined) { _scaleX = v; return stage; } return _scaleX; },
        scaleY: (v?: number) => { if (v !== undefined) { _scaleY = v; return stage; } return _scaleY; },
        x: (v?: number) => { if (v !== undefined) { _x = v; return stage; } return _x; },
        y: (v?: number) => { if (v !== undefined) { _y = v; return stage; } return _y; },
        getPointerPosition: () => ({ x: 400, y: 300 }),
        batchDraw: vi.fn(),
      };
      return stage;
    }

    function makeWheelEvent(deltaY: number, stage: any) {
      return {
        evt: { preventDefault: vi.fn(), deltaY },
        target: { getStage: () => stage },
      } as any;
    }

    beforeEach(() => {
      vi.useFakeTimers();
      rafCallbacks = [];
      rafId = 0;
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn((cb: (time: number) => void) => {
          rafCallbacks.push(cb);
          return ++rafId;
        })
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    function flushRAF() {
      const cbs = [...rafCallbacks];
      rafCallbacks = [];
      cbs.forEach((cb) => cb(performance.now()));
    }

    // Zoom idle timeout (ms) — viewport is committed to React state after this.
    const ZOOM_IDLE_TIMEOUT = 150;

    it("does not update viewport synchronously on wheel event", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      // Viewport should still be at defaults — RAF hasn't fired yet
      expect(result.current.viewport).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it("updates viewport after RAF fires", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      act(() => {
        flushRAF();
      });

      // During zoom, viewport is NOT committed to React state — the transform
      // is applied directly to the Konva Stage. React state updates once zoom
      // ends (after ZOOM_IDLE_TIMEOUT).
      expect(result.current.viewport.scale).toBe(1); // unchanged during zoom

      // Stage should have the new scale applied directly
      expect(stage.scaleX()).toBeGreaterThan(1);

      // After zoom idle timeout, React state is committed
      act(() => {
        vi.advanceTimersByTime(ZOOM_IDLE_TIMEOUT);
      });
      expect(result.current.viewport.scale).toBeGreaterThan(1);
    });

    it("batches multiple wheel events in the same frame into one viewport update", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        // Fire 5 rapid wheel events before RAF fires
        for (let i = 0; i < 5; i++) {
          result.current.onWheel(makeWheelEvent(-100, stage));
        }
      });

      // Only one RAF should have been scheduled
      expect(rafCallbacks).toHaveLength(1);

      act(() => {
        flushRAF();
      });

      // Stage should reflect all 5 zoom-in ticks compounded: 1.08^5
      const expectedScale = Math.pow(1.08, 5);
      expect(stage.scaleX()).toBeCloseTo(expectedScale, 4);

      // After zoom idle timeout, React state is committed
      act(() => {
        vi.advanceTimersByTime(ZOOM_IDLE_TIMEOUT);
      });
      expect(result.current.viewport.scale).toBeCloseTo(expectedScale, 4);
    });

    it("compounds zoom-out ticks correctly within a single frame", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        for (let i = 0; i < 3; i++) {
          result.current.onWheel(makeWheelEvent(100, stage));
        }
      });

      act(() => {
        flushRAF();
      });

      // Scale should reflect 3 zoom-out ticks: 1 / 1.08^3
      const expectedScale = Math.pow(1 / 1.08, 3);
      expect(stage.scaleX()).toBeCloseTo(expectedScale, 4);

      // After zoom idle timeout, React state is committed
      act(() => {
        vi.advanceTimersByTime(ZOOM_IDLE_TIMEOUT);
      });
      expect(result.current.viewport.scale).toBeCloseTo(expectedScale, 4);
    });

    it("clamps scale to MIN_SCALE (0.1)", () => {
      const { result } = renderHook(() => useCanvas());
      // Start at a very small scale
      const stage = makeMockStage(0.11);

      act(() => {
        // Zoom out many times to push below minimum
        for (let i = 0; i < 20; i++) {
          result.current.onWheel(makeWheelEvent(100, stage));
        }
      });

      act(() => {
        flushRAF();
      });

      expect(stage.scaleX()).toBeGreaterThanOrEqual(0.1);

      // After zoom idle timeout, React state is committed
      act(() => {
        vi.advanceTimersByTime(ZOOM_IDLE_TIMEOUT);
      });
      expect(result.current.viewport.scale).toBeGreaterThanOrEqual(0.1);
    });

    it("clamps scale to MAX_SCALE (4.0)", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage(3.9);

      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.onWheel(makeWheelEvent(-100, stage));
        }
      });

      act(() => {
        flushRAF();
      });

      expect(stage.scaleX()).toBeLessThanOrEqual(4.0);

      // After zoom idle timeout, React state is committed
      act(() => {
        vi.advanceTimersByTime(ZOOM_IDLE_TIMEOUT);
      });
      expect(result.current.viewport.scale).toBeLessThanOrEqual(4.0);
    });

    it("cancels pending RAF on unmount", () => {
      const { result, unmount } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      unmount();

      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it("prevents default on wheel event", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();
      const evt = makeWheelEvent(-100, stage);

      act(() => {
        result.current.onWheel(evt);
      });

      expect(evt.evt.preventDefault).toHaveBeenCalled();
    });

    it("no-ops when stage is null", () => {
      const { result } = renderHook(() => useCanvas());
      const evt = {
        evt: { preventDefault: vi.fn(), deltaY: -100 },
        target: { getStage: () => null },
      } as any;

      act(() => {
        result.current.onWheel(evt);
      });

      // No RAF scheduled
      expect(rafCallbacks).toHaveLength(0);
      expect(result.current.viewport).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it("no-ops when pointer position is null", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = {
        ...makeMockStage(),
        getPointerPosition: () => null,
      };

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      expect(rafCallbacks).toHaveLength(0);
    });
  });

  // ── isZooming state tests ──────────────────────────────────────────

  describe("isZooming state", () => {
    let rafCallbacks: ((time: number) => void)[];
    let rafId: number;

    function makeMockStage(scale = 1, x = 0, y = 0) {
      let _x = x, _y = y, _scaleX = scale, _scaleY = scale;
      const stage: any = {
        scaleX: (v?: number) => { if (v !== undefined) { _scaleX = v; return stage; } return _scaleX; },
        scaleY: (v?: number) => { if (v !== undefined) { _scaleY = v; return stage; } return _scaleY; },
        x: (v?: number) => { if (v !== undefined) { _x = v; return stage; } return _x; },
        y: (v?: number) => { if (v !== undefined) { _y = v; return stage; } return _y; },
        getPointerPosition: () => ({ x: 400, y: 300 }),
        batchDraw: vi.fn(),
      };
      return stage;
    }

    function makeWheelEvent(deltaY: number, stage: any) {
      return {
        evt: { preventDefault: vi.fn(), deltaY },
        target: { getStage: () => stage },
      } as any;
    }

    beforeEach(() => {
      vi.useFakeTimers();
      rafCallbacks = [];
      rafId = 0;
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn((cb: (time: number) => void) => {
          rafCallbacks.push(cb);
          return ++rafId;
        })
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("starts with isZooming false", () => {
      const { result } = renderHook(() => useCanvas());
      expect(result.current.isZooming).toBe(false);
    });

    it("sets isZooming to true on wheel event", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      expect(result.current.isZooming).toBe(true);
    });

    it("resets isZooming to false after 150ms of no wheel events", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      expect(result.current.isZooming).toBe(true);

      // Not yet reset at 149ms
      act(() => {
        vi.advanceTimersByTime(149);
      });
      expect(result.current.isZooming).toBe(true);

      // Reset at 150ms
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.isZooming).toBe(false);
    });

    it("extends the timeout when more wheel events arrive", () => {
      const { result } = renderHook(() => useCanvas());
      const stage = makeMockStage();

      act(() => {
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      // 100ms later, another wheel event
      act(() => {
        vi.advanceTimersByTime(100);
        result.current.onWheel(makeWheelEvent(-100, stage));
      });

      // 100ms after the second event (200ms from first) — still zooming
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current.isZooming).toBe(true);

      // 150ms after the second event — now false
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(result.current.isZooming).toBe(false);
    });
  });
});
