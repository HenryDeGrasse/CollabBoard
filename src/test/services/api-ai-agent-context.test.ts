/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { buildBoardContext } from "../../../api/_lib/aiAgent";

function makeObject(id: number) {
  return {
    id: `obj-${id}`,
    type: id % 10 === 0 ? "frame" : "sticky",
    x: id * 10,
    y: id * 5,
    width: 120,
    height: 120,
    color: "#FBBF24",
    text: `Object ${id}`,
    parentFrameId: id % 10 === 0 ? null : id % 20 === 1 ? "obj-0" : null,
  };
}

describe("buildBoardContext", () => {
  it("keeps full context for small boards", () => {
    const boardState = {
      objectCount: 20,
      connectorCount: 0,
      objects: Array.from({ length: 20 }, (_, i) => makeObject(i)),
      connectors: [],
    };

    const built = buildBoardContext(boardState, "simple", []);
    expect(built.scope).toBe("full");
    expect(built.payload).toBe(boardState);
  });

  it("builds a digest for large boards and preserves selected objects", () => {
    const boardState = {
      objectCount: 300,
      connectorCount: 120,
      objects: Array.from({ length: 300 }, (_, i) => makeObject(i)),
      connectors: Array.from({ length: 120 }, (_, i) => ({
        id: `conn-${i}`,
        fromId: `obj-${i}`,
        toId: `obj-${i + 1}`,
        style: "arrow",
      })),
    };

    const built = buildBoardContext(boardState, "simple", ["obj-5", "obj-42"]);
    expect(built.scope).toBe("digest");

    const payload = built.payload as any;
    expect(payload.objectCount).toBe(300);
    expect(payload.truncated.objectsOmitted).toBeGreaterThan(0);
    expect(payload.selectedObjects.map((o: any) => o.id)).toEqual(
      expect.arrayContaining(["obj-5", "obj-42"])
    );
  });
});
