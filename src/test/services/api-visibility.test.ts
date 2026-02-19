/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Shared mock stubs ──────────────────────────────────────────
const mockResult = { data: null, error: null };
const chain: any = {};
chain.select = vi.fn().mockReturnValue(chain);
chain.insert = vi.fn().mockReturnValue(chain);
chain.update = vi.fn().mockReturnValue(chain);
chain.delete = vi.fn().mockReturnValue(chain);
chain.upsert = vi.fn().mockResolvedValue(mockResult);
chain.eq = vi.fn().mockReturnValue(chain);
chain.gt = vi.fn().mockReturnValue(chain);
chain.in = vi.fn().mockReturnValue(chain);
chain.or = vi.fn().mockReturnValue(chain);
chain.order = vi.fn().mockReturnValue(chain);
chain.limit = vi.fn().mockReturnValue(chain);
chain.ilike = vi.fn().mockReturnValue(chain);
chain.maybeSingle = vi.fn().mockResolvedValue(mockResult);
chain.single = vi.fn().mockResolvedValue(mockResult);
const mockSupabase = { from: vi.fn().mockReturnValue(chain) };

const mockVerifyToken = vi.fn().mockResolvedValue("user-123");

vi.mock("../../../api/_lib/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  AuthError: class AuthError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "AuthError";
    }
  },
}));

vi.mock("../../../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => mockSupabase,
}));

import handler from "../../../api/boards/visibility";

// ── Helpers ────────────────────────────────────────────────────
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

// ── Tests ──────────────────────────────────────────────────────
describe("POST /api/boards/visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue("user-123");
    chain.select.mockReturnValue(chain);
    chain.insert.mockReturnValue(chain);
    chain.update.mockReturnValue(chain);
    chain.delete.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue(mockResult);
    chain.single.mockResolvedValue(mockResult);
    mockSupabase.from.mockReturnValue(chain);
  });

  it("returns 200 for OPTIONS preflight", async () => {
    const req = createReq({ method: "OPTIONS" });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it("returns 405 for non-POST methods", async () => {
    const req = createReq({ method: "GET" });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });

  it("returns 400 when boardId is missing", async () => {
    const req = createReq({ body: { visibility: "public" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "boardId is required" });
  });

  it("returns 400 when visibility is invalid", async () => {
    const req = createReq({ body: { boardId: "board-1", visibility: "unlisted" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "visibility must be 'public' or 'private'" });
  });

  it("returns 403 when caller is not a member", async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const req = createReq({ body: { boardId: "board-1", visibility: "public" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not a member of this board" });
  });

  it("returns 403 when caller is not an owner", async () => {
    chain.maybeSingle.mockResolvedValue({ data: { role: "editor" }, error: null });
    const req = createReq({ body: { boardId: "board-1", visibility: "public" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Only the board owner can change visibility" });
  });

  it("returns 200 when owner updates visibility", async () => {
    chain.maybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
    chain.update.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    const req = createReq({ body: { boardId: "board-1", visibility: "public" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSupabase.from).toHaveBeenCalledWith("boards");
  });
});
