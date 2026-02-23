import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockCreatePresenceChannel = vi.fn();
const mockGetNextCursorColor = vi.fn(() => "#EF4444");

vi.mock("../../../services/presence", () => ({
  createPresenceChannel: (...args: any[]) => mockCreatePresenceChannel(...args),
  getNextCursorColor: () => mockGetNextCursorColor(),
}));

import { usePresence } from "../../../hooks/presence/usePresence";

describe("usePresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps synced users as online with lastSeen", async () => {
    mockCreatePresenceChannel.mockImplementation(
      (_boardId: string, _userId: string, _displayName: string, _color: string, onSync: (state: Record<string, any[]>) => void) => {
        onSync({
          "user-1": [
            {
              displayName: "Alice",
              cursorColor: "#EF4444",
              cursor: { x: 100, y: 200 },
              editingObjectId: null,
            },
          ],
        });

        return {
          updateCursor: vi.fn(),
          setEditingObject: vi.fn(),
          setDraftText: vi.fn(),
          updateObjectDrag: vi.fn(),
          endObjectDrag: vi.fn(),
          unsubscribe: vi.fn(),
          channel: {},
        };
      }
    );

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(result.current.users["user-1"]).toBeDefined();
    });

    const user = result.current.users["user-1"] as any;
    expect(user.displayName).toBe("Alice");
    expect(user.online).toBe(true);
    expect(typeof user.lastSeen).toBe("number");
  });

  it("tracks remote frame resize previews with width/height", async () => {
    let onObjectDragHandler: ((...args: any[]) => void) | undefined;

    mockCreatePresenceChannel.mockImplementation(
      (
        _boardId: string,
        _userId: string,
        _displayName: string,
        _color: string,
        _onSync: (state: Record<string, any[]>) => void,
        _onCursor: (...args: any[]) => void,
        onObjectDrag: (...args: any[]) => void
      ) => {
        onObjectDragHandler = onObjectDrag;

        return {
          updateCursor: vi.fn(),
          setEditingObject: vi.fn(),
          setDraftText: vi.fn(),
          updateObjectDrag: vi.fn(),
          endObjectDrag: vi.fn(),
          unsubscribe: vi.fn(),
          channel: {},
        };
      }
    );

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(onObjectDragHandler).toBeDefined();
    });

    act(() => {
      onObjectDragHandler?.("user-2", "frame-1", { x: 120, y: 80 }, null, false, 420, 260);
    });

    await waitFor(() => {
      expect(result.current.remoteDragPositions["frame-1"]).toBeDefined();
    });

    const preview = result.current.remoteDragPositions["frame-1"] as any;
    expect(preview.x).toBe(120);
    expect(preview.y).toBe(80);
    expect(preview.width).toBe(420);
    expect(preview.height).toBe(260);
  });

  it("forwards width/height when broadcasting drag previews", async () => {
    const updateObjectDrag = vi.fn();

    mockCreatePresenceChannel.mockReturnValue({
      updateCursor: vi.fn(),
      setEditingObject: vi.fn(),
      setDraftText: vi.fn(),
      updateObjectDrag,
      endObjectDrag: vi.fn(),
      unsubscribe: vi.fn(),
      channel: {},
    });

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(mockCreatePresenceChannel).toHaveBeenCalled();
    });

    act(() => {
      (result.current.broadcastObjectDrag as any)("frame-1", 10, 20, null, 500, 280);
    });

    expect(updateObjectDrag).toHaveBeenCalledWith("frame-1", 10, 20, null, 500, 280);
  });

  it("does not collapse drag broadcasts across different object ids", async () => {
    const updateObjectDrag = vi.fn();

    mockCreatePresenceChannel.mockReturnValue({
      updateCursor: vi.fn(),
      setEditingObject: vi.fn(),
      setDraftText: vi.fn(),
      updateObjectDrag,
      endObjectDrag: vi.fn(),
      unsubscribe: vi.fn(),
      channel: {},
    });

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(mockCreatePresenceChannel).toHaveBeenCalled();
    });

    vi.useFakeTimers();

    act(() => {
      result.current.broadcastObjectDrag("frame-1", 10, 20, null);
      result.current.broadcastObjectDrag("sticky-1", 30, 40, "frame-1");
      result.current.broadcastObjectDrag("rect-1", 50, 60, "frame-1");
      vi.advanceTimersByTime(40);
    });

    const sentObjectIds = updateObjectDrag.mock.calls.map((call: any[]) => call[0]);
    expect(sentObjectIds).toEqual(expect.arrayContaining(["frame-1", "sticky-1", "rect-1"]));
  });

  it("delays clearing remote drag preview by 300ms on drag_end", async () => {
    let onObjectDragHandler: ((...args: any[]) => void) | undefined;

    mockCreatePresenceChannel.mockImplementation(
      (
        _boardId: string,
        _userId: string,
        _displayName: string,
        _color: string,
        _onSync: (state: Record<string, any[]>) => void,
        _onCursor: (...args: any[]) => void,
        onObjectDrag: (...args: any[]) => void
      ) => {
        onObjectDragHandler = onObjectDrag;
        return {
          updateCursor: vi.fn(),
          setEditingObject: vi.fn(),
          setDraftText: vi.fn(),
          updateObjectDrag: vi.fn(),
          endObjectDrag: vi.fn(),
          unsubscribe: vi.fn(),
          channel: {},
        };
      }
    );

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(onObjectDragHandler).toBeDefined();
    });

    vi.useFakeTimers();

    act(() => {
      onObjectDragHandler?.("user-2", "sticky-1", { x: 100, y: 120 }, null, false);
    });
    expect(result.current.remoteDragPositions["sticky-1"]).toBeDefined();

    act(() => {
      onObjectDragHandler?.("user-2", "sticky-1", { x: 0, y: 0 }, undefined, true);
    });

    // Not cleared immediately
    expect(result.current.remoteDragPositions["sticky-1"]).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.remoteDragPositions["sticky-1"]).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.remoteDragPositions["sticky-1"]).toBeUndefined();
  });

  it("cancels pending drag_end clear when a new drag update arrives", async () => {
    let onObjectDragHandler: ((...args: any[]) => void) | undefined;

    mockCreatePresenceChannel.mockImplementation(
      (
        _boardId: string,
        _userId: string,
        _displayName: string,
        _color: string,
        _onSync: (state: Record<string, any[]>) => void,
        _onCursor: (...args: any[]) => void,
        onObjectDrag: (...args: any[]) => void
      ) => {
        onObjectDragHandler = onObjectDrag;
        return {
          updateCursor: vi.fn(),
          setEditingObject: vi.fn(),
          setDraftText: vi.fn(),
          updateObjectDrag: vi.fn(),
          endObjectDrag: vi.fn(),
          unsubscribe: vi.fn(),
          channel: {},
        };
      }
    );

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(onObjectDragHandler).toBeDefined();
    });

    vi.useFakeTimers();

    act(() => {
      onObjectDragHandler?.("user-2", "sticky-1", { x: 100, y: 120 }, null, false);
      onObjectDragHandler?.("user-2", "sticky-1", { x: 0, y: 0 }, undefined, true);
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // New drag update arrives before the pending clear fires.
    act(() => {
      onObjectDragHandler?.("user-2", "sticky-1", { x: 130, y: 140 }, null, false);
    });

    // Advance beyond original 300ms window; object should still exist.
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.remoteDragPositions["sticky-1"]).toBeDefined();
    expect(result.current.remoteDragPositions["sticky-1"]?.x).toBe(130);
    expect(result.current.remoteDragPositions["sticky-1"]?.y).toBe(140);
  });

  it("flushes pending trailing drag position before sending drag_end", async () => {
    const updateObjectDrag = vi.fn();
    const endObjectDrag = vi.fn();

    mockCreatePresenceChannel.mockReturnValue({
      updateCursor: vi.fn(),
      setEditingObject: vi.fn(),
      setDraftText: vi.fn(),
      updateObjectDrag,
      endObjectDrag,
      unsubscribe: vi.fn(),
      channel: {},
    });

    const { result } = renderHook(() => usePresence("board-1", "user-1", "Alice"));

    await waitFor(() => {
      expect(mockCreatePresenceChannel).toHaveBeenCalled();
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));

    act(() => {
      // First call goes out immediately; second is throttled pending trailing call.
      result.current.broadcastObjectDrag("sticky-1", 10, 20, null);
      result.current.broadcastObjectDrag("sticky-1", 30, 40, null);
      // endObjectDrag should flush trailing call first, then emit drag_end.
      result.current.endObjectDrag("sticky-1");
    });

    expect(updateObjectDrag).toHaveBeenCalledTimes(2);
    expect(updateObjectDrag).toHaveBeenLastCalledWith("sticky-1", 30, 40, null, undefined, undefined);
    expect(endObjectDrag).toHaveBeenCalledWith("sticky-1");

    const lastDragOrder = updateObjectDrag.mock.invocationCallOrder.at(-1) ?? 0;
    const endOrder = endObjectDrag.mock.invocationCallOrder.at(0) ?? Number.MAX_SAFE_INTEGER;
    expect(lastDragOrder).toBeLessThan(endOrder);

    // No extra trailing call should fire later.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(updateObjectDrag).toHaveBeenCalledTimes(2);
  });
});
