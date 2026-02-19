/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResult = { data: null, error: null };
const chain: any = {};
chain.select = vi.fn().mockReturnValue(chain);
chain.insert = vi.fn().mockResolvedValue(mockResult);
chain.update = vi.fn().mockReturnValue(chain);
chain.upsert = vi.fn().mockResolvedValue(mockResult);
chain.eq = vi.fn().mockReturnValue(chain);
chain.in = vi.fn().mockReturnValue(chain);
chain.order = vi.fn().mockReturnValue(chain);
chain.maybeSingle = vi.fn().mockResolvedValue(mockResult);
chain.single = vi.fn().mockResolvedValue(mockResult);

const mockSupabase = { from: vi.fn().mockReturnValue(chain) };

vi.mock("../../../api/_lib/auth.js", () => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "AuthError";
    }
  }
  return {
    verifyToken: vi.fn().mockResolvedValue("user-123"),
    AuthError,
  };
});

vi.mock("../../../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabase),
}));

import handler from "../../../api/boards/access-requests/resolve";

function createReq(overrides: Partial<any> = {}): any {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    query: {},
    body: {},
    ...overrides,
  };
}

function createRes(): any {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chain mocks to default
  chain.select.mockReturnValue(chain);
  chain.insert.mockResolvedValue({ data: null, error: null });
  chain.update.mockReturnValue(chain);
  chain.upsert.mockResolvedValue({ data: null, error: null });
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase.from.mockReturnValue(chain);
});

describe("api/boards/access-requests/resolve handler", () => {
  it("OPTIONS returns 200", async () => {
    const req = createReq({ method: "OPTIONS" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it("non-POST returns 405", async () => {
    const req = createReq({ method: "GET" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });

  it("missing requestId returns 400", async () => {
    const req = createReq({ body: { decision: "approve" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "requestId is required" });
  });

  it("invalid decision returns 400", async () => {
    const req = createReq({ body: { requestId: "req-1", decision: "maybe" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "decision must be approve or deny" });
  });

  it("request not found returns 404", async () => {
    // board_access_requests lookup returns null
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = createReq({ body: { requestId: "req-1", decision: "approve" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Request not found" });
  });

  it("already resolved returns 409", async () => {
    // board_access_requests lookup returns already-resolved request
    chain.maybeSingle.mockResolvedValueOnce({
      data: { id: "req-1", board_id: "board-1", requester_id: "requester-1", status: "approved" },
      error: null,
    });

    const req = createReq({ body: { requestId: "req-1", decision: "approve" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "Request has already been resolved" });
  });

  it("non-owner returns 403", async () => {
    // First: request lookup - pending request
    chain.maybeSingle
      .mockResolvedValueOnce({
        data: { id: "req-1", board_id: "board-1", requester_id: "requester-1", status: "pending" },
        error: null,
      })
      // Second: board_members caller lookup - not owner
      .mockResolvedValueOnce({ data: { role: "editor" }, error: null });

    const req = createReq({ body: { requestId: "req-1", decision: "approve" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Only board owners can resolve access requests" });
  });

  it("approve: updates status and inserts member returns 200", async () => {
    // First: request lookup - pending
    chain.maybeSingle
      .mockResolvedValueOnce({
        data: { id: "req-1", board_id: "board-1", requester_id: "requester-1", status: "pending" },
        error: null,
      })
      // Second: caller membership check - owner
      .mockResolvedValueOnce({ data: { role: "owner" }, error: null })
      // Third: existing member check for requester - not a member yet
      .mockResolvedValueOnce({ data: null, error: null });

    // insert for board_members succeeds
    chain.insert.mockResolvedValueOnce({ data: null, error: null });

    // update for access request status (via .update().eq() - the chain.eq resolves)
    // The update chain ends with .eq() which returns the chain, and the resolved value
    // comes from the awaited chain itself. We need to mock the update path properly.
    // Since .update() returns chain and .eq() returns chain, the final await on the
    // chain after .eq() needs to resolve. Let's mock it as a thenable.

    const req = createReq({ body: { requestId: "req-1", decision: "approve" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSupabase.from).toHaveBeenCalledWith("board_members");
    expect(mockSupabase.from).toHaveBeenCalledWith("board_access_requests");
  });

  it("deny: updates status returns 200", async () => {
    // First: request lookup - pending
    chain.maybeSingle
      .mockResolvedValueOnce({
        data: { id: "req-1", board_id: "board-1", requester_id: "requester-1", status: "pending" },
        error: null,
      })
      // Second: caller membership check - owner
      .mockResolvedValueOnce({ data: { role: "owner" }, error: null });

    const req = createReq({ body: { requestId: "req-1", decision: "deny" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
