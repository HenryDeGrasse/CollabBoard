/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResult = { data: null, error: null };
const chain: any = {};
chain.select = vi.fn().mockReturnValue(chain);
chain.insert = vi.fn().mockResolvedValue(mockResult);
chain.eq = vi.fn().mockReturnValue(chain);
chain.maybeSingle = vi.fn().mockResolvedValue(mockResult);

const mockSupabase = { from: vi.fn().mockReturnValue(chain) };
const mockVerifyToken = vi.fn().mockResolvedValue("user-123");

vi.mock("../../../api/_lib/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  AuthError: class extends Error {
    status: number;
    constructor(s: number, m: string) {
      super(m);
      this.status = s;
      this.name = "AuthError";
    }
  },
}));
vi.mock("../../../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => mockSupabase,
}));

import handler from "../../../api/invites/accept";

// ── helpers ──────────────────────────────────────────────────

function makeReq(overrides: Record<string, any> = {}): any {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: { token: "invite-token" },
    ...overrides,
  };
}

function makeRes(): any {
  const res: any = {
    _status: 0,
    _body: null,
    _ended: false,
    _headers: {} as Record<string, string>,
  };
  res.setHeader = vi.fn((k: string, v: string) => {
    res._headers[k] = v;
    return res;
  });
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res._body = body;
    return res;
  });
  res.end = vi.fn(() => {
    res._ended = true;
    return res;
  });
  return res;
}

// ── tests ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyToken.mockResolvedValue("user-123");
  chain.select.mockReturnValue(chain);
  chain.insert.mockResolvedValue(mockResult);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(mockResult);
  mockSupabase.from.mockReturnValue(chain);
});

describe("POST /api/invites/accept", () => {
  it("OPTIONS returns 200", async () => {
    const req = makeReq({ method: "OPTIONS" });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
  });

  it("non-POST returns 405", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("missing token in body returns 400", async () => {
    const req = makeReq({ body: {} });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "token is required" }),
    );
  });

  it("invite not found returns 404", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("not found") }),
    );
  });

  it("expired invite returns 410", async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    chain.maybeSingle.mockResolvedValueOnce({
      data: { id: "inv-1", board_id: "board-1", expires_at: pastDate },
      error: null,
    });

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("expired") }),
    );
  });

  it("already a member returns 200 with alreadyMember: true", async () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();

    chain.maybeSingle
      .mockResolvedValueOnce({
        data: { id: "inv-1", board_id: "board-1", expires_at: futureDate },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { role: "editor" },
        error: null,
      });

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      boardId: "board-1",
      role: "editor",
      alreadyMember: true,
    });
  });

  it("new member is inserted as editor and returns 200", async () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();

    chain.maybeSingle
      .mockResolvedValueOnce({
        data: { id: "inv-1", board_id: "board-1", expires_at: futureDate },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      });

    chain.insert.mockResolvedValueOnce({ data: null, error: null });

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      boardId: "board-1",
      role: "editor",
      alreadyMember: false,
    });
    expect(mockSupabase.from).toHaveBeenCalledWith("board_members");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: "board-1",
        user_id: "user-123",
        role: "editor",
      }),
    );
  });

  it("AuthError from verifyToken propagates correctly", async () => {
    // Import the mocked AuthError to throw it
    const { AuthError } = await import("../../../api/_lib/auth.js");
    mockVerifyToken.mockRejectedValueOnce(new AuthError(401, "Invalid or expired token"));

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid or expired token" }),
    );
  });
});
