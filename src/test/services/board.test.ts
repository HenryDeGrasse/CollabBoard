import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFrom = vi.fn();

const mockBoardsInsert = vi.fn();
const mockBoardsUpdate = vi.fn();
const mockBoardsEq = vi.fn();

const mockBoardMembersInsert = vi.fn();
const mockBoardMembersSelect = vi.fn();
const mockBoardMembersEq1 = vi.fn();
const mockBoardMembersEq2 = vi.fn();
const mockBoardMembersMaybeSingle = vi.fn();
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
            return { eq: (...b: any[]) => mockBoardsEq(...b) };
          },
          delete: () => ({
            eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }),
        };
      }

      if (table === "board_members") {
        return {
          insert: (...a: any[]) => mockBoardMembersInsert(...a),
          select: (...a: any[]) => {
            mockBoardMembersSelect(...a);
            return {
              eq: (...b1: any[]) => {
                mockBoardMembersEq1(...b1);
                return {
                  eq: (...b2: any[]) => {
                    mockBoardMembersEq2(...b2);
                    return {
                      maybeSingle: (...c: any[]) => mockBoardMembersMaybeSingle(...c),
                    };
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
} from "../../services/board";

describe("Board service (Supabase)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockBoardsInsert.mockResolvedValue({ error: null });
    mockBoardMembersInsert.mockResolvedValue({ error: null });
    mockBoardsEq.mockResolvedValue({ error: null });

    mockBoardMembersMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockRpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      });
      expect(mockFrom).toHaveBeenCalledWith("board_members");
      expect(mockBoardMembersInsert).toHaveBeenCalledWith({
        board_id: generatedId,
        user_id: "user-123",
        role: "owner",
      });
    });
  });

  describe("softDeleteBoard", () => {
    it("updates deleted_at field", async () => {
      await softDeleteBoard("board-123");
      expect(mockFrom).toHaveBeenCalledWith("boards");
      expect(mockBoardsUpdate).toHaveBeenCalledWith(expect.objectContaining({
        deleted_at: expect.any(String),
      }));
    });
  });

  describe("updateBoardMetadata", () => {
    it("updates title", async () => {
      await updateBoardMetadata("board-123", { title: "New Title" });
      expect(mockFrom).toHaveBeenCalledWith("boards");
      expect(mockBoardsUpdate).toHaveBeenCalledWith({ title: "New Title" });
    });
  });

  describe("joinBoard", () => {
    it("checks existing membership before insert", async () => {
      await joinBoard("board-123", "user-456");

      expect(mockFrom).toHaveBeenCalledWith("board_members");
      expect(mockBoardMembersSelect).toHaveBeenCalledWith("board_id");
      expect(mockBoardMembersEq1).toHaveBeenCalledWith("board_id", "board-123");
      expect(mockBoardMembersEq2).toHaveBeenCalledWith("user_id", "user-456");
      expect(mockBoardMembersInsert).toHaveBeenCalledWith({
        board_id: "board-123",
        user_id: "user-456",
        role: "editor",
      });
    });

    it("skips insert when membership already exists", async () => {
      mockBoardMembersMaybeSingle.mockResolvedValueOnce({
        data: { board_id: "board-123" },
        error: null,
      });

      await joinBoard("board-123", "user-456");
      expect(mockBoardMembersInsert).not.toHaveBeenCalled();
    });

    it("treats duplicate membership race as success", async () => {
      mockBoardMembersInsert.mockResolvedValueOnce({ error: { code: "23505" } });
      await expect(joinBoard("board-123", "user-456")).resolves.toBeUndefined();
    });

    it("throws 'Board not found' on foreign key violations", async () => {
      mockBoardMembersInsert.mockResolvedValueOnce({ error: { code: "23503" } });
      await expect(joinBoard("board-missing", "user-456")).rejects.toThrow("Board not found");
    });
  });

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
