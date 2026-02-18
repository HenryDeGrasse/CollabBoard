import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BoardObject } from "../../types/board";

const mockFetchBoardObjects = vi.fn();
const mockFetchBoardConnectors = vi.fn();
const mockFetchBoardMetadata = vi.fn();
const mockUpdateObject = vi.fn();
const mockCreateObject = vi.fn();
const mockDeleteObject = vi.fn();
const mockDeleteFrameCascade = vi.fn();
const mockCreateConnector = vi.fn();
const mockDeleteConnector = vi.fn();

const mockCreateBoardRealtimeChannels = vi.fn();
const mockRemoveChannel = vi.fn();

let objectChangeHandler: ((eventType: "INSERT" | "UPDATE" | "DELETE", row: any) => void) | null = null;
let connectorChangeHandler: ((eventType: "INSERT" | "UPDATE" | "DELETE", row: any) => void) | null = null;

vi.mock("../../services/board", () => ({
  fetchBoardObjects: (...args: any[]) => mockFetchBoardObjects(...args),
  fetchBoardConnectors: (...args: any[]) => mockFetchBoardConnectors(...args),
  fetchBoardMetadata: (...args: any[]) => mockFetchBoardMetadata(...args),
  updateObject: (...args: any[]) => mockUpdateObject(...args),
  createObject: (...args: any[]) => mockCreateObject(...args),
  deleteObject: (...args: any[]) => mockDeleteObject(...args),
  deleteFrameCascade: (...args: any[]) => mockDeleteFrameCascade(...args),
  createConnector: (...args: any[]) => mockCreateConnector(...args),
  deleteConnector: (...args: any[]) => mockDeleteConnector(...args),
}));

vi.mock("../../services/presence", () => ({
  createBoardRealtimeChannels: (...args: any[]) => mockCreateBoardRealtimeChannels(...args),
}));

vi.mock("../../services/supabase", () => ({
  supabase: {
    removeChannel: (...args: any[]) => mockRemoveChannel(...args),
  },
}));

import { useBoard } from "../../hooks/useBoard";

describe("useBoard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    const obj: BoardObject = {
      id: "obj-1",
      type: "sticky",
      x: 0,
      y: 0,
      width: 150,
      height: 150,
      color: "#FBBF24",
      text: "",
      rotation: 0,
      zIndex: 1,
      createdBy: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentFrameId: null,
    };

    mockFetchBoardObjects.mockResolvedValue({ "obj-1": obj });
    mockFetchBoardConnectors.mockResolvedValue({});
    mockFetchBoardMetadata.mockResolvedValue({ id: "board-1", title: "Test Board", ownerId: "user-1", createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null });
    mockUpdateObject.mockResolvedValue(undefined);
    mockCreateObject.mockResolvedValue("obj-2");
    mockDeleteObject.mockResolvedValue(undefined);
    mockDeleteFrameCascade.mockResolvedValue(undefined);
    mockCreateConnector.mockResolvedValue("conn-1");
    mockDeleteConnector.mockResolvedValue(undefined);

    objectChangeHandler = null;
    connectorChangeHandler = null;
    mockCreateBoardRealtimeChannels.mockImplementation(
      (_boardId: string, onObjectChange: any, onConnectorChange: any) => {
        objectChangeHandler = onObjectChange;
        connectorChangeHandler = onConnectorChange;
        return [{ id: "channel-objects" }, { id: "channel-connectors" }];
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid object updates before writing to backend", async () => {
    const { result } = renderHook(() => useBoard("board-1"));

    // Flush initial async fetch promises
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.updateObject("obj-1", { x: 10 });
      result.current.updateObject("obj-1", { x: 20 });
      result.current.updateObject("obj-1", { y: 30 });
    });

    // Should not hit backend immediately for each drag tick
    expect(mockUpdateObject).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(39);
    });
    expect(mockUpdateObject).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Single backend write with latest merged values
    expect(mockUpdateObject).toHaveBeenCalledTimes(1);
    expect(mockUpdateObject).toHaveBeenCalledWith("board-1", "obj-1", { x: 20, y: 30 });
  });

  it("ignores stale realtime updates while local changes are pending", async () => {
    const { result } = renderHook(() => useBoard("board-1"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.objects["obj-1"]?.x).toBe(0);

    // Local drag update (optimistic)
    act(() => {
      result.current.updateObject("obj-1", { x: 200 });
    });
    expect(result.current.objects["obj-1"]?.x).toBe(200);

    // Realtime sends older position before flush (common during drag)
    const now = new Date().toISOString();
    act(() => {
      objectChangeHandler?.("UPDATE", {
        id: "obj-1",
        type: "sticky",
        x: 0,
        y: 0,
        width: 150,
        height: 150,
        color: "#FBBF24",
        text: "",
        rotation: 0,
        z_index: 1,
        created_by: "user-1",
        created_at: now,
        updated_at: now,
        parent_frame_id: null,
      });
    });

    // Local optimistic value should win to avoid flicker
    expect(result.current.objects["obj-1"]?.x).toBe(200);
  });

  it("optimistically removes a frame and its contained objects in one cascade call", async () => {
    const frame: BoardObject = {
      id: "frame-1",
      type: "frame",
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      color: "#F8FAFC",
      text: "Frame",
      rotation: 0,
      zIndex: 0,
      createdBy: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentFrameId: null,
    };

    const child: BoardObject = {
      id: "child-1",
      type: "sticky",
      x: 120,
      y: 140,
      width: 150,
      height: 150,
      color: "#FBBF24",
      text: "",
      rotation: 0,
      zIndex: 1,
      createdBy: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentFrameId: "frame-1",
    };

    const outside: BoardObject = {
      id: "outside-1",
      type: "rectangle",
      x: 600,
      y: 100,
      width: 150,
      height: 100,
      color: "#FBBF24",
      text: "",
      rotation: 0,
      zIndex: 2,
      createdBy: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentFrameId: null,
    };

    mockFetchBoardObjects.mockResolvedValueOnce({
      "frame-1": frame,
      "child-1": child,
      "outside-1": outside,
    });

    const { result } = renderHook(() => useBoard("board-1"));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.deleteFrameCascade("frame-1");
    });

    expect(result.current.objects["frame-1"]).toBeUndefined();
    expect(result.current.objects["child-1"]).toBeUndefined();
    expect(result.current.objects["outside-1"]).toBeDefined();
    expect(mockDeleteFrameCascade).toHaveBeenCalledWith("board-1", "frame-1");
  });
});
