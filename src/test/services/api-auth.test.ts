/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSupabase: any = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
};

vi.mock("../../../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabase),
}));

import { verifyToken, assertCanWriteBoard, AuthError } from "../../../api/_lib/auth";

function mockChain(finalResult: any) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(finalResult),
          maybeSingle: vi.fn().mockResolvedValue(finalResult),
        }),
        single: vi.fn().mockResolvedValue(finalResult),
        maybeSingle: vi.fn().mockResolvedValue(finalResult),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyToken", () => {
  it("throws AuthError(401) when header is null", async () => {
    await expect(verifyToken(null)).rejects.toThrow(AuthError);
    await expect(verifyToken(null)).rejects.toMatchObject({ status: 401 });
  });

  it("throws AuthError(401) when header lacks 'Bearer ' prefix", async () => {
    await expect(verifyToken("Token abc")).rejects.toThrow(AuthError);
    await expect(verifyToken("Token abc")).rejects.toMatchObject({ status: 401 });
  });

  it("throws AuthError(401) when token is empty ('Bearer ')", async () => {
    await expect(verifyToken("Bearer ")).rejects.toThrow(AuthError);
    await expect(verifyToken("Bearer ")).rejects.toMatchObject({ status: 401 });
  });

  it("throws AuthError(401) when supabase.auth.getUser returns error", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });

    await expect(verifyToken("Bearer bad-token")).rejects.toThrow(AuthError);
    await expect(verifyToken("Bearer bad-token")).rejects.toMatchObject({ status: 401 });
  });

  it("returns user.id on success", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid-123" } },
      error: null,
    });

    const result = await verifyToken("Bearer valid-token");
    expect(result).toBe("user-uuid-123");
    expect(mockSupabase.auth.getUser).toHaveBeenCalledWith("valid-token");
  });
});

describe("assertCanWriteBoard", () => {
  it("throws AuthError(404) when board not found", async () => {
    mockSupabase.from.mockReturnValue(
      mockChain({ data: null, error: { message: "not found" } })
    );

    await expect(assertCanWriteBoard("uid-1", "board-1")).rejects.toThrow(AuthError);
    await expect(assertCanWriteBoard("uid-1", "board-1")).rejects.toMatchObject({ status: 404 });
  });

  it("throws AuthError(403) when user is not a member", async () => {
    const boardChain = mockChain({ data: { id: "board-1" }, error: null });
    const memberChain = mockChain({ data: null, error: { message: "not found" } });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return callCount % 2 === 1 ? boardChain : memberChain;
    });

    await expect(assertCanWriteBoard("uid-1", "board-1")).rejects.toThrow(AuthError);
    await expect(assertCanWriteBoard("uid-1", "board-1")).rejects.toMatchObject({ status: 403 });
  });

  it("throws AuthError(403) when role is 'viewer'", async () => {
    const boardChain = mockChain({ data: { id: "board-1" }, error: null });
    const memberChain = mockChain({ data: { role: "viewer" }, error: null });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return callCount % 2 === 1 ? boardChain : memberChain;
    });

    await expect(assertCanWriteBoard("uid-1", "board-1")).rejects.toThrow(AuthError);
    await expect(assertCanWriteBoard("uid-1", "board-1")).rejects.toMatchObject({ status: 403 });
  });

  it("resolves for owner role", async () => {
    const boardChain = mockChain({ data: { id: "board-1" }, error: null });
    const memberChain = mockChain({ data: { role: "owner" }, error: null });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return callCount % 2 === 1 ? boardChain : memberChain;
    });

    await expect(assertCanWriteBoard("uid-1", "board-1")).resolves.toBeUndefined();
  });

  it("resolves for editor role", async () => {
    const boardChain = mockChain({ data: { id: "board-1" }, error: null });
    const memberChain = mockChain({ data: { role: "editor" }, error: null });

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return callCount % 2 === 1 ? boardChain : memberChain;
    });

    await expect(assertCanWriteBoard("uid-1", "board-1")).resolves.toBeUndefined();
  });
});
