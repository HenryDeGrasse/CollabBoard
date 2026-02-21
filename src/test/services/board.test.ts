import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mock stubs ──────────────────────────────────────────
const mockFrom = vi.fn();

// boards table
const mockBoardsInsert     = vi.fn();
const mockBoardsUpdate     = vi.fn();
const mockBoardsUpdateEq   = vi.fn();
const mockBoardsSelect     = vi.fn();
const mockBoardsSelectEq   = vi.fn();
const mockBoardsSelectMaybeSingle = vi.fn();

// board_members table
const mockMembersInsert    = vi.fn();
const mockMembersSelect    = vi.fn();
const mockMembersEq1       = vi.fn();
const mockMembersEq2       = vi.fn();
const mockMembersMaybeSingle = vi.fn();

const mockRpc = vi.fn();

vi.mock("../../services/supabase", () => ({
  supabase: {
    from: (...args: any[]) => {
      const table = args[0];
      mockFrom(table);

      if (table === "boards") {
        return {
          insert: (...a: any[]) => mockBoardsInsert(...a),
          update: (...a: any[]) => {
            mockBoardsUpdate(...a);
            return { eq: (...b: any[]) => mockBoardsUpdateEq(...b) };
          },
          select: (...a: any[]) => {
            mockBoardsSelect(...a);
            return {
              eq: (...b: any[]) => {
                mockBoardsSelectEq(...b);
                return { maybeSingle: (...c: any[]) => mockBoardsSelectMaybeSingle(...c) };
              },
            };
          },
          delete: () => ({
            eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }),
        };
      }

      if (table === "board_members") {
        return {
          insert: (...a: any[]) => mockMembersInsert(...a),
          select: (...a: any[]) => {
            mockMembersSelect(...a);
            return {
              eq: (...b1: any[]) => {
                mockMembersEq1(...b1);
                return {
                  eq: (...b2: any[]) => {
                    mockMembersEq2(...b2);
                    return { maybeSingle: (...c: any[]) => mockMembersMaybeSingle(...c) };
                  },
                };
              },
            };
          },
        };
      }

      return {
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      };
    },
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

import {
  createBoard,
  softDeleteBoard,
  joinBoard,
  updateBoardMetadata,
  deleteFrameCascade,
  getBoardMembers,
} from "../../services/board";

describe("Board service (Supabase)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path stubs
    mockBoardsInsert.mockResolvedValue({ error: null });
    mockMembersInsert.mockResolvedValue({ error: null });
    mockBoardsUpdateEq.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ error: null });

    // joinBoard: no existing membership by default
    mockMembersMaybeSingle.mockResolvedValue({ data: null, error: null });

    // boards visibility check: public by default
    mockBoardsSelectMaybeSingle.mockResolvedValue({
      data: { id: "board-123", visibility: "public" },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── createBoard ──────────────────────────────────────────────

  describe("createBoard", () => {
    it("uses client-generated board id and does not require SELECT on boards insert", async () => {
      const generatedId = "00000000-0000-0000-0000-000000000001";
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(generatedId);

      const boardId = await createBoard("Test Board", "user-123");

      expect(boardId).toBe(generatedId);
      expect(mockFrom).toHaveBeenCalledWith("boards");
      expect(mockBoardsInsert).toHaveBeenCalledWith({
        id: generatedId,
        title: "Test Board",
        owner_id: "user-123",
        visibility: "public",   // default
      });
      expect(mockFrom).toHaveBeenCalledWith("board_members");
      expect(mockMembersInsert).toHaveBeenCalledWith({
        board_id: generatedId,
        user_id: "user-123",
        role: "owner",
      });
    });

    it("passes explicit visibility to insert", async () => {
      const generatedId = "00000000-0000-0000-0000-000000000002";
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(generatedId);

      await createBoard("Secret Board", "user-123", "private");

      expect(mockBoardsInsert).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: "private" })
      );
    });
  });

  // ── softDeleteBoard ──────────────────────────────────────────

  describe("softDeleteBoard", () => {
    it("updates deleted_at field", async () => {
      await softDeleteBoard("board-123");
      expect(mockFrom).toHaveBeenCalledWith("boards");
      expect(mockBoardsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ deleted_at: expect.any(String) })
      );
    });
  });

  // ── updateBoardMetadata ──────────────────────────────────────

  describe("updateBoardMetadata", () => {
    it("updates title", async () => {
      await updateBoardMetadata("board-123", { title: "New Title" });
      expect(mockFrom).toHaveBeenCalledWith("boards");
      expect(mockBoardsUpdate).toHaveBeenCalledWith({ title: "New Title" });
    });
  });

  // ── joinBoard ────────────────────────────────────────────────

  describe("joinBoard", () => {
    it("returns { status: 'member' } when already a member", async () => {
      mockMembersMaybeSingle.mockResolvedValueOnce({
        data: { role: "editor" },
        error: null,
      });

      const result = await joinBoard("board-123", "user-456");
      expect(result).toEqual({ status: "member", role: "editor" });
      expect(mockMembersInsert).not.toHaveBeenCalled();
    });

    it("checks membership then board visibility, inserts on public board", async () => {
      // Not a member
      mockMembersMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      // Board is public
      mockBoardsSelectMaybeSingle.mockResolvedValueOnce({
        data: { id: "board-123", visibility: "public" },
        error: null,
      });
      mockMembersInsert.mockResolvedValueOnce({ error: null });

      const result = await joinBoard("board-123", "user-456");

      expect(result).toEqual({ status: "joined" });
      expect(mockMembersInsert).toHaveBeenCalledWith({
        board_id: "board-123",
        user_id: "user-456",
        role: "editor",
      });
    });

    it("returns { status: 'private' } for a private board (no insert)", async () => {
      mockMembersMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockBoardsSelectMaybeSingle.mockResolvedValueOnce({
        data: { id: "board-priv", visibility: "private" },
        error: null,
      });

      const result = await joinBoard("board-priv", "user-456");

      expect(result).toEqual({ status: "private" });
      expect(mockMembersInsert).not.toHaveBeenCalled();
    });

    it("returns { status: 'not_found' } when board does not exist", async () => {
      mockMembersMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockBoardsSelectMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await joinBoard("board-missing", "user-456");

      expect(result).toEqual({ status: "not_found" });
      expect(mockMembersInsert).not.toHaveBeenCalled();
    });

    it("treats duplicate insert race (23505) as already-member success", async () => {
      mockMembersMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockBoardsSelectMaybeSingle.mockResolvedValueOnce({
        data: { id: "board-123", visibility: "public" },
        error: null,
      });
      mockMembersInsert.mockResolvedValueOnce({ error: { code: "23505" } });

      const result = await joinBoard("board-123", "user-456");
      expect(result).toEqual({ status: "member", role: "editor" });
    });
  });

  // ── getBoardMembers ──────────────────────────────────────────

  describe("getBoardMembers", () => {
    it("calls the /api/boards/members endpoint, NOT Supabase directly — regression for RLS blind spot", async () => {
      // Before the fix, getBoardMembers queried Supabase directly, which RLS
      // restricts to the caller's own row only. Other members were invisible.
      // After the fix it must use fetch() to go through the service-role API.
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          members: [
            { userId: "user-123", role: "owner", displayName: "Alice" },
            { userId: "other-user", role: "editor", displayName: "Bob" },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const members = await getBoardMembers("board-123", "test-token");

      // Must have called fetch, not supabase
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/boards/members"),
        expect.objectContaining({ method: "GET" })
      );

      // Must return both members, not just the caller
      expect(members).toHaveLength(2);
      expect(members.map((m) => m.userId)).toContain("other-user");

      // Supabase must NOT have been called for the member list
      expect(mockFrom).not.toHaveBeenCalledWith("board_members");

      vi.unstubAllGlobals();
    });

    it("forwards the session token as Authorization header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ members: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await getBoardMembers("board-123", "my-session-token");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-session-token",
          }),
        })
      );

      vi.unstubAllGlobals();
    });
  });

  // ── deleteFrameCascade ───────────────────────────────────────

  describe("deleteFrameCascade", () => {
    it("deletes frame + contained objects via a single RPC", async () => {
      await deleteFrameCascade("board-123", "frame-123");
      expect(mockRpc).toHaveBeenCalledWith("delete_frame_cascade", {
        p_board_id: "board-123",
        p_frame_id: "frame-123",
      });
    });
  });
});
