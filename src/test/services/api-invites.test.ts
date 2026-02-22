/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Test fixture constants
const TEST_AUTH_TOKEN = "test-token";
const TEST_UNKNOWN_TOKEN = "unknown-token";
const TEST_EXPIRED_TOKEN = "expired-token";
const TEST_VALID_TOKEN = "valid-token";
const TEST_EXISTING_INVITE_TOKEN = "existing-invite-token";

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

import handler from "../../../api/invites";

// ── Helpers ────────────────────────────────────────────────────
function createReq(overrides: Partial<any> = {}): any {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
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
describe("/api/invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue("user-123");
    chain.select.mockReturnValue(chain);
    chain.insert.mockReturnValue(chain);
    chain.update.mockReturnValue(chain);
    chain.delete.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.gt.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
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

  // ── GET ────────────────────────────────────────────────────────
  describe("GET /api/invites?token=xxx", () => {
    it("returns 400 when token query param is missing", async () => {
      const req = createReq({ method: "GET", query: {} });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "token is required" });
    });

    it("returns 404 when token is not found", async () => {
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const req = createReq({ method: "GET", query: { token: TEST_UNKNOWN_TOKEN } });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ valid: false, reason: "not_found" });
    });

    it("returns valid:false with reason expired for expired token", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
      chain.maybeSingle.mockResolvedValue({
        data: { expires_at: pastDate, boards: { title: "Old Board" } },
        error: null,
      });
      const req = createReq({ method: "GET", query: { token: TEST_EXPIRED_TOKEN } });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ valid: false, reason: "expired" });
    });

    it("returns valid:true with boardTitle for a valid token", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
      chain.maybeSingle.mockResolvedValue({
        data: { expires_at: futureDate, boards: { title: "My Board" } },
        error: null,
      });
      const req = createReq({ method: "GET", query: { token: TEST_VALID_TOKEN } });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ valid: true, boardTitle: "My Board" });
    });
  });

  // ── POST ───────────────────────────────────────────────────────
  describe("POST /api/invites", () => {
    it("returns 400 when boardId is missing", async () => {
      const req = createReq({ method: "POST", body: {} });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "boardId is required" });
    });

    it("returns 403 when caller is not a member", async () => {
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const req = createReq({ method: "POST", body: { boardId: "board-1" } });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: "Not a member of this board" });
    });

    it("returns existing token when not rotating", async () => {
      // First maybeSingle: membership check
      // Second maybeSingle: existing token lookup
      let maybeSingleCallCount = 0;
      chain.maybeSingle.mockImplementation(() => {
        maybeSingleCallCount++;
        if (maybeSingleCallCount === 1) {
          return Promise.resolve({ data: { role: "editor" }, error: null });
        }
        return Promise.resolve({ data: { token: TEST_EXISTING_INVITE_TOKEN }, error: null });
      });

      const req = createReq({
        method: "POST",
        body: { boardId: "board-1", rotate: false },
      });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ token: TEST_EXISTING_INVITE_TOKEN });
    });
  });

  // ── DELETE ─────────────────────────────────────────────────────
  describe("DELETE /api/invites", () => {
    it("returns 403 when caller is not an owner", async () => {
      chain.maybeSingle.mockResolvedValue({ data: { role: "editor" }, error: null });
      const req = createReq({ method: "DELETE", body: { boardId: "board-1" } });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: "Only owners can revoke invite links" });
    });

    it("returns 200 when owner deletes all invite tokens", async () => {
      chain.maybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
      chain.delete.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      const req = createReq({ method: "DELETE", body: { boardId: "board-1" } });
      const res = createRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSupabase.from).toHaveBeenCalledWith("board_invites");
    });
  });
});
