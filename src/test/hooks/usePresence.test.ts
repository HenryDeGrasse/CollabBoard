import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockCreatePresenceChannel = vi.fn();
const mockGetNextCursorColor = vi.fn(() => "#EF4444");

vi.mock("../../services/presence", () => ({
  createPresenceChannel: (...args: any[]) => mockCreatePresenceChannel(...args),
  getNextCursorColor: () => mockGetNextCursorColor(),
}));

import { usePresence } from "../../hooks/usePresence";

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
});
