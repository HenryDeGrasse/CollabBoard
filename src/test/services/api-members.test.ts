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

import handler from "../../../api/boards/members";

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

describe("GET /api/boards/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue("user-123");
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue(mockResult);
    mockSupabase.from.mockReturnValue(chain);
  });

  it("returns 400 when boardId is missing", async () => {
    const req = createReq({ method: "GET", query: {} });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "boardId is required" });
  });

  it("returns 403 when caller is not a member", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const req = createReq({ method: "GET", query: { boardId: "board-1" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not a member of this board" });
  });

  it("returns ALL members including non-callers — regression for RLS blind spot", async () => {
    // Step 1: caller membership check resolves to owner
    chain.maybeSingle.mockResolvedValueOnce({ data: { role: "owner" }, error: null });

    // Step 2: full board_members query returns two rows (caller + collaborator)
    // The final .eq() call resolves with the member list
    chain.eq.mockReturnValueOnce(chain) // board_id eq on membership check
          .mockReturnValueOnce(chain)   // user_id eq on membership check  → maybeSingle above
          .mockResolvedValueOnce({      // board_id eq on full members fetch
            data: [
              { user_id: "user-123", role: "owner" },
              { user_id: "other-user", role: "editor" },
            ],
            error: null,
          });

    // Step 3: profiles query resolves with names
    chain.in.mockResolvedValueOnce({
      data: [
        { id: "user-123", display_name: "Alice" },
        { id: "other-user", display_name: "Bob" },
      ],
      error: null,
    });

    const req = createReq({ method: "GET", query: { boardId: "board-1" } });
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.members).toHaveLength(2);

    const userIds = res.body.members.map((m: any) => m.userId);
    // Both the caller AND the collaborator must be present
    expect(userIds).toContain("user-123");
    expect(userIds).toContain("other-user");

    const names = res.body.members.map((m: any) => m.displayName);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  it("returns empty list when board has no members", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: { role: "owner" }, error: null });
    chain.eq.mockReturnValueOnce(chain)
          .mockReturnValueOnce(chain)
          .mockResolvedValueOnce({ data: [], error: null });

    const req = createReq({ method: "GET", query: { boardId: "board-1" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ members: [] });
  });
});

describe("POST /api/boards/members", () => {
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

  it("returns 405 for unsupported methods", async () => {
    const req = createReq({ method: "DELETE" });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });

  it("returns 400 when boardId or userId is missing", async () => {
    const req = createReq({ body: { boardId: "board-1" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "boardId and userId are required" });
  });

  it("returns 403 when caller is not a member", async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const req = createReq({ body: { boardId: "board-1", userId: "other-user" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not a member of this board" });
  });

  it("returns 403 when editor tries to remove another member", async () => {
    chain.maybeSingle.mockResolvedValue({ data: { role: "editor" }, error: null });
    const req = createReq({ body: { boardId: "board-1", userId: "other-user" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Only owners can remove other members" });
  });

  it("returns 400 when owner tries to remove themselves", async () => {
    chain.maybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
    const req = createReq({ body: { boardId: "board-1", userId: "user-123" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "You cannot leave a board you own. Transfer ownership first.",
    });
  });

  it("returns 200 when owner removes an editor", async () => {
    chain.maybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
    chain.eq.mockReturnValue(chain);
    // The delete chain resolves with no error
    chain.delete.mockReturnValue(chain);
    const req = createReq({ body: { boardId: "board-1", userId: "editor-456" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSupabase.from).toHaveBeenCalledWith("board_members");
  });

  it("returns 200 when editor removes themselves (leave)", async () => {
    chain.maybeSingle.mockResolvedValue({ data: { role: "editor" }, error: null });
    chain.delete.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    const req = createReq({ body: { boardId: "board-1", userId: "user-123" } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
