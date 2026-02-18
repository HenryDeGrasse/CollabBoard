import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendAICommand, continueAICommand } from "../../services/ai-agent";
import { supabase } from "../../services/supabase";

describe("ai-agent service", () => {
  const mockSession = {
    access_token: "token-123",
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns auth error when no session exists", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as any);

    const result = await sendAICommand({
      boardId: "board-1",
      command: "add sticky",
      viewport: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        centerX: 50,
        centerY: 50,
        scale: 1,
      },
      selectedObjectIds: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not authenticated");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses provided commandId and sends authenticated /api/ai-agent request", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    } as any);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        message: "ok",
        objectsCreated: ["obj-1"],
        objectsUpdated: [],
        objectsDeleted: [],
        runId: "cmd-1",
      }),
    } as any);

    await sendAICommand({
      commandId: "cmd-1",
      boardId: "board-1",
      command: "add sticky",
      viewport: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        centerX: 50,
        centerY: 50,
        scale: 1,
      },
      selectedObjectIds: ["a"],
      pointer: { x: 10, y: 20 },
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/ai-agent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      })
    );

    const [, requestInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.commandId).toBe("cmd-1");
    expect(body.selectedObjectIds).toEqual(["a"]);
    expect(body.pointer).toEqual({ x: 10, y: 20 });
  });

  it("surfaces API error payload from /api/ai-agent", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    } as any);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: "Invalid or expired token" }),
    } as any);

    const result = await sendAICommand({
      boardId: "board-1",
      command: "add sticky",
      viewport: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        centerX: 50,
        centerY: 50,
        scale: 1,
      },
      selectedObjectIds: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid or expired token");
  });

  it("posts resume payload to /api/ai-continue", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    } as any);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        message: "resumed",
        objectsCreated: [],
        objectsUpdated: [],
        objectsDeleted: [],
        runId: "cmd-2",
      }),
    } as any);

    await continueAICommand(
      "board-1",
      "cmd-2",
      {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        centerX: 50,
        centerY: 50,
        scale: 1,
      },
      ["obj-a", "obj-b"]
    );

    const [url, requestInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai-continue");
    const body = JSON.parse(String(requestInit.body));
    expect(body).toEqual({
      boardId: "board-1",
      commandId: "cmd-2",
      viewport: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        centerX: 50,
        centerY: 50,
        scale: 1,
      },
      selectedIds: ["obj-a", "obj-b"],
    });
  });

  it("returns stable error shape when resume fetch throws", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    } as any);

    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    const result = await continueAICommand("board-1", "cmd-3");

    expect(result.success).toBe(false);
    expect(result.message).toBe("AI resume failed");
    expect(result.error).toBe("network down");
    expect(result.runId).toBe("cmd-3");
  });
});
