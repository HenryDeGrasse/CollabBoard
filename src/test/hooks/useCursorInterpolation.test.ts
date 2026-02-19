import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCursorInterpolation } from "../../hooks/useCursorInterpolation";
import type { CursorStore } from "../../hooks/usePresence";

/** Helper: create a mock CursorStore backed by a plain object */
function createMockCursorStore(initial: Record<string, { x: number; y: number }> = {}) {
  let positions = { ...initial };
  const listeners = new Set<() => void>();
  const store: CursorStore = {
    get: () => positions,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const update = (next: Record<string, { x: number; y: number }>) => {
    positions = next;
    for (const l of listeners) l();
  };
  return { store, update };
}

const CURRENT_USER = "me";

function makeUsers(...entries: { id: string; displayName: string; color: string }[]) {
  const users: Record<string, { id: string; displayName: string; cursorColor: string; online: boolean }> = {};
  for (const e of entries) {
    users[e.id] = { id: e.id, displayName: e.displayName, cursorColor: e.color, online: true };
  }
  return users;
}

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

  it("returns empty array when no cursors are present", () => {
    const { store } = createMockCursorStore();
    const users = {};
    const { result } = renderHook(() => useCursorInterpolation(store, users, CURRENT_USER));
    expect(result.current).toEqual([]);
  });

  it("snaps to initial position on first cursor appearance", () => {
    perfNow = 100;
    const { store } = createMockCursorStore({ u1: { x: 50, y: 75 } });
    const users = makeUsers({ id: "u1", displayName: "Alice", color: "#EF4444" });
    const { result } = renderHook(() => useCursorInterpolation(store, users, CURRENT_USER));

    // Should snap — no interpolation on first appearance
    expect(result.current[0].x).toBe(50);
    expect(result.current[0].y).toBe(75);
  });

  it("passes through displayName and color", () => {
    perfNow = 0;
    const { store } = createMockCursorStore({ u1: { x: 10, y: 20 } });
    const users = makeUsers({ id: "u1", displayName: "Bob", color: "#3B82F6" });
    const { result } = renderHook(() => useCursorInterpolation(store, users, CURRENT_USER));

    expect(result.current[0].displayName).toBe("Bob");
    expect(result.current[0].color).toBe("#3B82F6");
    expect(result.current[0].id).toBe("u1");
  });

  it("handles cursor removal (departed users)", () => {
    perfNow = 0;
    const { store, update } = createMockCursorStore({ u1: { x: 10, y: 10 } });
    const users = makeUsers({ id: "u1", displayName: "Alice", color: "#EF4444" });

    const { result, rerender } = renderHook(
      ({ u }) => useCursorInterpolation(store, u, CURRENT_USER),
      { initialProps: { u: users } }
    );

    expect(result.current.length).toBe(1);

    // Remove the cursor from the store and the user list
    act(() => { update({}); });
    rerender({ u: {} });

    expect(result.current.length).toBe(0);
  });

  it("handles multiple cursors", () => {
    perfNow = 0;
    const { store } = createMockCursorStore({
      u1: { x: 10, y: 10 },
      u2: { x: 100, y: 200 },
    });
    const users = makeUsers(
      { id: "u1", displayName: "Alice", color: "#EF4444" },
      { id: "u2", displayName: "Bob", color: "#3B82F6" },
    );
    const { result } = renderHook(() => useCursorInterpolation(store, users, CURRENT_USER));

    expect(result.current.length).toBe(2);
    const ids = result.current.map((c) => c.id).sort();
    expect(ids).toEqual(["u1", "u2"]);
  });

  it("skips update when position hasn't changed", () => {
    perfNow = 0;
    const { store, update } = createMockCursorStore({ u1: { x: 50, y: 75 } });
    const users = makeUsers({ id: "u1", displayName: "Alice", color: "#EF4444" });
    const { result } = renderHook(() => useCursorInterpolation(store, users, CURRENT_USER));

    // Re-notify with same position
    perfNow = 30;
    act(() => { update({ u1: { x: 50, y: 75 } }); });

    // Position should remain the same (snapped)
    expect(result.current[0].x).toBe(50);
    expect(result.current[0].y).toBe(75);
  });

  it("starts interpolation on position update", () => {
    perfNow = 0;
    const { store, update } = createMockCursorStore({ u1: { x: 0, y: 0 } });
    const users = makeUsers({ id: "u1", displayName: "Alice", color: "#EF4444" });
    const { result } = renderHook(() => useCursorInterpolation(store, users, CURRENT_USER));

    // Update position at t=30ms
    perfNow = 30;
    act(() => { update({ u1: { x: 100, y: 200 } }); });

    // After rAF at the end of duration, position should be at target
    act(() => { flushRAF(60); });

    expect(result.current[0].x).toBe(100);
    expect(result.current[0].y).toBe(200);
  });
});
