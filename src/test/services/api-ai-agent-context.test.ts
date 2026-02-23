/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  buildBoardContext,
  hasFastPathMatch,
  selectToolDefinitions,
} from "../../../api/_lib/aiAgent";

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

describe("selectToolDefinitions", () => {
  it("includes layout tools for layout-heavy commands", () => {
    const tools = selectToolDefinitions(
      "Create a mind map for launch planning",
      "complex",
      false
    );

    const names = tools.map((t) => t.function.name);
    expect(names).toContain("createMindMap");
    expect(names).toContain("get_board_context");
    expect(names).toContain("search_objects");
  });

  it("keeps clear_board out unless explicitly requested", () => {
    const tools = selectToolDefinitions("Add 3 yellow sticky notes", "simple", false);
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain("clear_board");
  });

  it("excludes selection tools when no selection and no selection keywords", () => {
    const tools = selectToolDefinitions("Add a blue sticky note", "simple", false);
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain("arrange_objects");
    expect(names).not.toContain("duplicate_objects");
  });

  it("includes selection tools when hasSelection is true", () => {
    const tools = selectToolDefinitions("Move these to a grid", "simple", true);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("arrange_objects");
    expect(names).toContain("duplicate_objects");
  });
});

describe("hasFastPathMatch", () => {
  it("matches canonical template commands", () => {
    expect(hasFastPathMatch("Create a SWOT analysis for Q2")).toBe(true);
    expect(hasFastPathMatch("Set up a retrospective board")).toBe(true);
  });

  it("does not match non-template commands", () => {
    expect(hasFastPathMatch("Rename these two stickies")).toBe(false);
  });
});
