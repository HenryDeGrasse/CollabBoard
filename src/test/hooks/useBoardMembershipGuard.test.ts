import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoardMembershipGuard } from "../../hooks/useBoardMembershipGuard";

const mockMaybeSingle = vi.fn();
const mockEq2 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

const mockSubscribe = vi.fn(() => ({ id: "ch-1" }));
let realtimeCallback: (() => void) | null = null;
const mockOn = vi.fn((_event, _filter, cb) => {
  realtimeCallback = cb;
  return { subscribe: mockSubscribe };
});
const mockChannel = vi.fn(() => ({ on: mockOn }));
const mockRemoveChannel = vi.fn();

vi.mock("../../services/supabase", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: (...args: any[]) => mockChannel(...args),
    removeChannel: (...args: any[]) => mockRemoveChannel(...args),
  },
}));

describe("useBoardMembershipGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    realtimeCallback = null;
    mockMaybeSingle.mockResolvedValue({ data: { role: "editor" }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to board_members changes and cleans up", () => {
    const onRemoved = vi.fn();
    const { unmount } = renderHook(() =>
      useBoardMembershipGuard({ boardId: "b1", userId: "u1", onRemoved, pollMs: 1000 })
    );

    expect(mockChannel).toHaveBeenCalled();
    expect(mockOn).toHaveBeenCalled();

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("kicks user when realtime check finds no membership", async () => {
    const onRemoved = vi.fn();
    renderHook(() =>
      useBoardMembershipGuard({ boardId: "b1", userId: "u1", onRemoved, pollMs: 1000 })
    );

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await act(async () => {
      realtimeCallback?.();
      await Promise.resolve();
    });

    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("kicks user on polling fallback when membership is gone", async () => {
    const onRemoved = vi.fn();
    renderHook(() =>
      useBoardMembershipGuard({ boardId: "b1", userId: "u1", onRemoved, pollMs: 1000 })
    );

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(onRemoved).toHaveBeenCalledTimes(1);
  });
});
