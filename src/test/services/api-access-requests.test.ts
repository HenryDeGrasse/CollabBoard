/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResult = { data: null, error: null };
const chain: any = {};
chain.select = vi.fn().mockReturnValue(chain);
chain.insert = vi.fn().mockReturnValue(chain);
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

import handler from "../../../api/boards/access-requests";

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
  chain.insert.mockReturnValue(chain);
  chain.upsert.mockResolvedValue(mockResult);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase.from.mockReturnValue(chain);
});

describe("api/boards/access-requests handler", () => {
  it("OPTIONS returns 200", async () => {
    const req = createReq({ method: "OPTIONS" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it("GET without boardId returns 400", async () => {
    const req = createReq({ method: "GET", query: {} });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "boardId is required" });
  });

  it("GET by non-owner returns 403", async () => {
    // First .from("board_members") call returns non-owner role
    chain.maybeSingle.mockResolvedValueOnce({ data: { role: "editor" }, error: null });

    const req = createReq({ method: "GET", query: { boardId: "board-1" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Only board owners can view access requests" });
  });

  it("POST without boardId returns 400", async () => {
    const req = createReq({ method: "POST", body: {} });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "boardId is required" });
  });

  it("POST for non-existent board returns 404", async () => {
    // boards lookup returns null
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = createReq({ method: "POST", body: { boardId: "nonexistent" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Board not found" });
  });

  it("POST when already member returns 409", async () => {
    // First call: boards lookup - board exists
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: "board-1" }, error: null })
      // Second call: board_members lookup - already member
      .mockResolvedValueOnce({ data: { role: "editor" }, error: null });

    const req = createReq({ method: "POST", body: { boardId: "board-1" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "You already have access to this board" });
  });

  it("POST successful upsert returns 200", async () => {
    // First call: boards lookup - board exists
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: "board-1" }, error: null })
      // Second call: board_members lookup - not a member
      .mockResolvedValueOnce({ data: null, error: null });

    // upsert succeeds
    chain.upsert.mockResolvedValueOnce({ data: null, error: null });

    const req = createReq({ method: "POST", body: { boardId: "board-1", message: "Please let me in" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("unsupported method returns 405", async () => {
    const req = createReq({ method: "DELETE" });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });
});
