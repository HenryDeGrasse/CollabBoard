import { describe, it, expect, vi, beforeEach } from "vitest";
import { push, set, update, remove, get } from "firebase/database";
import {
  createBoard,
  getBoardMetadata,
  createObject,
  updateObject,
  deleteObject,
  createConnector,
  deleteConnector,
} from "../../services/board";

vi.mock("../../services/firebase", () => ({ db: {} }));

describe("Board service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (push as any).mockReturnValue({ key: "mock-push-key" });
    (get as any).mockResolvedValue({ val: () => null });
  });

  describe("createBoard", () => {
    it("calls set with metadata containing title and ownerId", () => {
      createBoard("board-1", "My Board", "user-1");

      expect(set).toHaveBeenCalledTimes(1);
      const callArgs = (set as any).mock.calls[0];
      const metadata = callArgs[1];
      expect(metadata.title).toBe("My Board");
      expect(metadata.ownerId).toBe("user-1");
      expect(typeof metadata.createdAt).toBe("number");
    });
  });

  describe("getBoardMetadata", () => {
    it("returns null when board doesn't exist", async () => {
      (get as any).mockResolvedValue({ val: () => null });
      const result = await getBoardMetadata("nonexistent");
      expect(result).toBeNull();
    });

    it("returns metadata when board exists", async () => {
      const mockMeta = { title: "Test", ownerId: "user-1", createdAt: 123 };
      (get as any).mockResolvedValue({ val: () => mockMeta });
      const result = await getBoardMetadata("board-1");
      expect(result).toEqual(mockMeta);
    });
  });

  describe("createObject", () => {
    it("returns the generated push key as ID", () => {
      const id = createObject("board-1", {
        type: "sticky",
        x: 0,
        y: 0,
        width: 150,
        height: 150,
        color: "#FEF3C7",
        text: "Test",
        rotation: 0,
        zIndex: 1,
        createdBy: "user-1",
      });

      expect(id).toBe("mock-push-key");
    });

    it("calls set with full object including id and timestamps", () => {
      createObject("board-1", {
        type: "sticky",
        x: 10,
        y: 20,
        width: 150,
        height: 150,
        color: "#FEF3C7",
        text: "Hello",
        rotation: 0,
        zIndex: 1,
        createdBy: "user-1",
      });

      expect(set).toHaveBeenCalledTimes(1);
      const obj = (set as any).mock.calls[0][1];
      expect(obj.id).toBe("mock-push-key");
      expect(obj.type).toBe("sticky");
      expect(obj.text).toBe("Hello");
      expect(obj.x).toBe(10);
      expect(typeof obj.createdAt).toBe("number");
      expect(typeof obj.updatedAt).toBe("number");
    });
  });

  describe("updateObject", () => {
    it("calls update with the provided updates", () => {
      updateObject("board-1", "obj-1", { text: "Updated" });

      expect(update).toHaveBeenCalledTimes(1);
      const updates = (update as any).mock.calls[0][1];
      expect(updates.text).toBe("Updated");
    });
  });

  describe("deleteObject", () => {
    it("calls remove", () => {
      deleteObject("board-1", "obj-1");
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });

  describe("createConnector", () => {
    it("returns the generated push key as ID", () => {
      const id = createConnector("board-1", {
        fromId: "obj-1",
        toId: "obj-2",
        style: "arrow",
      });

      expect(id).toBe("mock-push-key");
    });

    it("calls set with connector data including id", () => {
      createConnector("board-1", {
        fromId: "obj-1",
        toId: "obj-2",
        style: "arrow",
      });

      const conn = (set as any).mock.calls[0][1];
      expect(conn.id).toBe("mock-push-key");
      expect(conn.fromId).toBe("obj-1");
      expect(conn.toId).toBe("obj-2");
      expect(conn.style).toBe("arrow");
    });
  });

  describe("deleteConnector", () => {
    it("calls remove", () => {
      deleteConnector("board-1", "conn-1");
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
