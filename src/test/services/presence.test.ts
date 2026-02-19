import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChannel = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn(),
  track: vi.fn().mockResolvedValue(undefined),
  untrack: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
  presenceState: vi.fn(() => ({})),
};

const mockRemoveChannel = vi.fn();

vi.mock("../../services/supabase", () => ({
  supabase: {
    channel: vi.fn(() => mockChannel),
    removeChannel: (...args: any[]) => mockRemoveChannel(...args),
  },
}));

import { getNextCursorColor, createPresenceChannel, createBoardRealtimeChannels } from "../../services/presence";
import { supabase } from "../../services/supabase";

describe("getNextCursorColor", () => {
  it("returns a string color", () => {
    const color = getNextCursorColor();
    expect(typeof color).toBe("string");
    expect(color.startsWith("#")).toBe(true);
  });

  it("cycles through colors", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(getNextCursorColor());
    }
    // Should have at most 8 unique colors (CURSOR_COLORS length)
    expect(colors.size).toBeLessThanOrEqual(8);
    expect(colors.size).toBeGreaterThan(0);
  });
});

describe("createPresenceChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannel.on.mockReturnThis();
    mockChannel.subscribe.mockImplementation((cb: (status: string) => void) => {
      cb("SUBSCRIBED");
      return mockChannel;
    });
  });

  it("creates a channel with correct name", () => {
    createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    expect(supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^board-presence:board-1:/), expect.any(Object));
  });

  it("subscribes and tracks presence on SUBSCRIBED", () => {
    createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    expect(mockChannel.subscribe).toHaveBeenCalled();
    expect(mockChannel.track).toHaveBeenCalled();
  });

  it("returns updateCursor that broadcasts", () => {
    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.updateCursor(100, 200);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "broadcast",
        event: "cursor",
        payload: { userId: "user-1", x: 100, y: 200 },
      })
    );
  });

  it("returns setEditingObject that tracks presence", () => {
    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.setEditingObject("obj-1");
    // track should be called (initial + setEditingObject)
    expect(mockChannel.track).toHaveBeenCalledTimes(2);
  });

  it("returns setDraftText that tracks presence", () => {
    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.setDraftText("obj-1", "hello");
    expect(mockChannel.track).toHaveBeenCalledTimes(2);
  });

  it("returns updateObjectDrag that broadcasts", () => {
    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.updateObjectDrag("obj-1", 50, 60);
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "broadcast",
        event: "object_drag",
        payload: expect.objectContaining({ userId: "user-1", objectId: "obj-1", x: 50, y: 60 }),
      })
    );
  });

  it("returns endObjectDrag that broadcasts", () => {
    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.endObjectDrag("obj-1");
    expect(mockChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "broadcast",
        event: "object_drag_end",
        payload: { userId: "user-1", objectId: "obj-1" },
      })
    );
  });

  it("unsubscribe calls untrack and removeChannel", () => {
    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.unsubscribe();
    expect(mockChannel.untrack).toHaveBeenCalled();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("does not broadcast when channel is not ready", () => {
    mockChannel.subscribe.mockImplementation((cb: (status: string) => void) => {
      cb("CONNECTING"); // Not SUBSCRIBED
      return mockChannel;
    });

    const handle = createPresenceChannel("board-1", "user-1", "Alice", "#EF4444", vi.fn());
    handle.updateCursor(10, 20);
    expect(mockChannel.send).not.toHaveBeenCalled();
  });
});

describe("createBoardRealtimeChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannel.on.mockReturnThis();
    mockChannel.subscribe.mockReturnValue(mockChannel);
  });

  it("creates two channels (objects + connectors)", () => {
    const channels = createBoardRealtimeChannels("board-1", vi.fn(), vi.fn());
    expect(supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^board-objects:board-1:/));
    expect(supabase.channel).toHaveBeenCalledWith(expect.stringMatching(/^board-connectors:board-1:/));
    expect(channels).toHaveLength(2);
  });

  it("subscribes both channels", () => {
    createBoardRealtimeChannels("board-1", vi.fn(), vi.fn());
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(2);
  });

  it("sets up postgres_changes listeners", () => {
    createBoardRealtimeChannels("board-1", vi.fn(), vi.fn());
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "objects" }),
      expect.any(Function)
    );
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "connectors" }),
      expect.any(Function)
    );
  });
});
