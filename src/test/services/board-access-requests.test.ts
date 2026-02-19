import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestBoardAccess,
  listBoardAccessRequests,
  resolveBoardAccessRequest,
} from "../../services/board";

describe("board access request service helpers", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock as any);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests board access via API", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await requestBoardAccess("board-1", "token-123", "please add me");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/access-requests",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
      })
    );
  });

  it("lists pending access requests", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        requests: [
          { id: "req-1", requesterId: "u1", requesterName: "Alice", message: "pls", createdAt: "2026-01-01" },
        ],
      }),
    });

    const requests = await listBoardAccessRequests("board-1", "token-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/access-requests?boardId=board-1",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer token-123" },
      })
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].requesterName).toBe("Alice");
  });

  it("resolves (approves/denies) an access request", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await resolveBoardAccessRequest("req-1", "approve", "token-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/access-requests/resolve",
      expect.objectContaining({
        method: "POST",
      })
    );
  });
});
