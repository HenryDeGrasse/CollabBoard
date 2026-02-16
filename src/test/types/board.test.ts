import { describe, it, expect } from "vitest";
import type { BoardObject, Connector, BoardMetadata } from "../../types/board";

describe("Board types", () => {
  it("BoardObject has required fields", () => {
    const obj: BoardObject = {
      id: "test-id",
      type: "sticky",
      x: 0,
      y: 0,
      width: 150,
      height: 150,
      color: "#FEF3C7",
      text: "Hello",
      rotation: 0,
      zIndex: 1,
      createdBy: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(obj.id).toBe("test-id");
    expect(obj.type).toBe("sticky");
    expect(obj.width).toBe(150);
  });

  it("BoardObject supports all types", () => {
    const types: BoardObject["type"][] = ["sticky", "rectangle", "circle", "line", "frame"];
    types.forEach((type) => {
      const obj: BoardObject = {
        id: `test-${type}`,
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        color: "#000",
        text: "",
        rotation: 0,
        zIndex: 0,
        createdBy: "user",
        createdAt: 0,
        updatedAt: 0,
      };
      expect(obj.type).toBe(type);
    });
  });

  it("Connector has required fields", () => {
    const conn: Connector = {
      id: "conn-1",
      fromId: "obj-1",
      toId: "obj-2",
      style: "arrow",
    };

    expect(conn.fromId).toBe("obj-1");
    expect(conn.toId).toBe("obj-2");
    expect(conn.style).toBe("arrow");
  });

  it("Connector supports line style", () => {
    const conn: Connector = {
      id: "conn-2",
      fromId: "a",
      toId: "b",
      style: "line",
    };
    expect(conn.style).toBe("line");
  });

  it("BoardMetadata has required fields", () => {
    const meta: BoardMetadata = {
      title: "My Board",
      ownerId: "user-1",
      createdAt: Date.now(),
    };

    expect(meta.title).toBe("My Board");
    expect(meta.ownerId).toBe("user-1");
  });
});
