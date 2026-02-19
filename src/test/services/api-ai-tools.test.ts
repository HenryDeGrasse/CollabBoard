/* @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResult = { data: null, error: null };
let chain: any;

function freshChain() {
  const c: any = {};
  c.select = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.delete = vi.fn().mockReturnValue(c);
  c.upsert = vi.fn().mockResolvedValue(mockResult);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.or = vi.fn().mockReturnValue(c);
  c.ilike = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(mockResult);
  c.maybeSingle = vi.fn().mockResolvedValue(mockResult);
  return c;
}

chain = freshChain();

const mockSupabase = { from: vi.fn().mockReturnValue(chain) };

vi.mock("../../../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => mockSupabase,
}));

import {
  TOOL_DEFINITIONS,
  executeTool,
  fetchBoardState,
  colorLabel,
} from "../../../api/_lib/aiTools";

const BOARD_ID = "board-1";
const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  chain = freshChain();
  mockSupabase.from.mockReturnValue(chain);
});

// ── TOOL_DEFINITIONS ─────────────────────────────────────────

describe("TOOL_DEFINITIONS", () => {
  it("has 15 tool definitions", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(15);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
    }
  });
});

// ── colorLabel ───────────────────────────────────────────────

describe("colorLabel", () => {
  it('returns "purple" for "#A855F7"', () => {
    expect(colorLabel("#A855F7")).toBe("purple");
  });

  it('returns "yellow" for "#FBBF24"', () => {
    expect(colorLabel("#FBBF24")).toBe("yellow");
  });

  it("returns the hex string when no name matches", () => {
    expect(colorLabel("#123456")).toBe("#123456");
  });
});

// ── executeTool ──────────────────────────────────────────────

describe("executeTool", () => {
  it("create_objects inserts objects and returns created IDs", async () => {
    chain.select.mockResolvedValueOnce({
      data: [{ id: "new-1" }, { id: "new-2" }],
      error: null,
    });

    const result: any = await executeTool(
      "create_objects",
      {
        objects: [
          { type: "sticky", x: 0, y: 0 },
          { type: "rectangle", x: 100, y: 100 },
        ],
      },
      BOARD_ID,
      USER_ID,
    );

    expect(result.created).toBe(2);
    expect(result.ids).toEqual(["new-1", "new-2"]);
    expect(mockSupabase.from).toHaveBeenCalledWith("objects");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ board_id: BOARD_ID, type: "sticky" }),
        expect.objectContaining({ board_id: BOARD_ID, type: "rectangle" }),
      ]),
    );
  });

  it("create_connectors inserts connectors and returns IDs", async () => {
    chain.select.mockResolvedValueOnce({
      data: [{ id: "conn-1" }],
      error: null,
    });

    const result: any = await executeTool(
      "create_connectors",
      {
        connectors: [
          { fromId: "a", toId: "b", style: "arrow" },
        ],
      },
      BOARD_ID,
      USER_ID,
    );

    expect(result.created).toBe(1);
    expect(result.ids).toEqual(["conn-1"]);
    expect(mockSupabase.from).toHaveBeenCalledWith("connectors");
  });

  it("update_objects updates object fields", async () => {
    // update().eq("id", id).eq("board_id", boardId) — first eq returns chain,
    // second eq must resolve (it is awaited).
    let eqCallCount = 0;
    chain.eq.mockImplementation(() => {
      eqCallCount++;
      // The second .eq() is the terminal call that gets awaited
      if (eqCallCount % 2 === 0) return Promise.resolve({ error: null });
      return chain;
    });

    const result: any = await executeTool(
      "update_objects",
      {
        patches: [{ id: "obj-1", text: "updated", color: "#FF0000" }],
      },
      BOARD_ID,
      USER_ID,
    );

    expect(result.updated).toBe(1);
    expect(result.results[0]).toEqual(
      expect.objectContaining({ id: "obj-1", ok: true }),
    );
    expect(mockSupabase.from).toHaveBeenCalledWith("objects");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ text: "updated", color: "#ff0000" }),
    );
  });

  it("delete_objects deletes objects and cleans up connectors", async () => {
    // The connector cleanup call: .from("connectors").delete().eq().or() -> resolves
    // The object delete call: .from("objects").delete().eq().in() -> resolves
    chain.or.mockResolvedValueOnce({ error: null });
    chain.in.mockResolvedValueOnce({ error: null });

    const result: any = await executeTool(
      "delete_objects",
      { ids: ["obj-1", "obj-2"] },
      BOARD_ID,
      USER_ID,
    );

    expect(result.deleted).toBe(2);
    expect(result.message).toContain("2");
    expect(mockSupabase.from).toHaveBeenCalledWith("connectors");
    expect(mockSupabase.from).toHaveBeenCalledWith("objects");
  });

  it("clear_board deletes all objects and connectors", async () => {
    // First call: connectors delete -> .from("connectors").delete().eq("board_id", ...)
    // Second call: objects delete -> .from("objects").delete().eq("board_id", ...)
    chain.eq.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: null });

    const result: any = await executeTool("clear_board", {}, BOARD_ID, USER_ID);

    expect(result.message).toBe("Board cleared.");
    expect(mockSupabase.from).toHaveBeenCalledWith("connectors");
    expect(mockSupabase.from).toHaveBeenCalledWith("objects");
  });

  it("search_objects returns matching objects", async () => {
    chain.ilike.mockResolvedValueOnce({
      data: [
        {
          id: "obj-1",
          type: "sticky",
          x: 10,
          y: 20,
          width: 150,
          height: 150,
          color: "#FBBF24",
          text: "Hello",
          parent_frame_id: null,
        },
      ],
      error: null,
    });

    const result: any = await executeTool(
      "search_objects",
      { text: "Hello" },
      BOARD_ID,
      USER_ID,
    );

    expect(result.found).toBe(1);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toEqual(
      expect.objectContaining({ id: "obj-1", type: "sticky", text: "Hello" }),
    );
  });

  it("delete_objects_by_filter returns error for unrecognized color", async () => {
    const result: any = await executeTool(
      "delete_objects_by_filter",
      { color: "chartreuse" },
      BOARD_ID,
      USER_ID,
    );

    expect(result.error).toMatch(/Unrecogni/i);
  });

  it("delete_objects_by_filter works with valid color name", async () => {
    // First: select query to find matching objects
    chain.ilike.mockResolvedValueOnce({
      data: [{ id: "obj-1" }, { id: "obj-2" }],
      error: null,
    });
    // Connector cleanup
    chain.or.mockResolvedValueOnce({ error: null });
    // Object deletion
    chain.in.mockResolvedValueOnce({ error: null });

    const result: any = await executeTool(
      "delete_objects_by_filter",
      { color: "purple" },
      BOARD_ID,
      USER_ID,
    );

    expect(result.deleted).toBe(2);
  });

  it("returns error for unknown tool name", async () => {
    const result: any = await executeTool(
      "nonexistent_tool",
      {},
      BOARD_ID,
      USER_ID,
    );

    expect(result.error).toContain("Unknown tool");
  });

  it("navigate_to_objects returns viewport calculation", async () => {
    // .from("objects").select(...).eq(...).in(...) resolves with objects
    chain.in.mockResolvedValueOnce({
      data: [
        { x: 100, y: 100, width: 200, height: 200 },
        { x: 400, y: 400, width: 200, height: 200 },
      ],
      error: null,
    });

    const result: any = await executeTool(
      "navigate_to_objects",
      { ids: ["obj-1", "obj-2"] },
      BOARD_ID,
      USER_ID,
      { screenSize: { width: 1280, height: 800 } },
    );

    expect(result._viewport).toBeDefined();
    expect(result._viewport.x).toEqual(expect.any(Number));
    expect(result._viewport.y).toEqual(expect.any(Number));
    expect(result._viewport.scale).toEqual(expect.any(Number));
    expect(result.message).toContain("2 object(s)");
  });
});

// ── fetchBoardState ──────────────────────────────────────────

describe("fetchBoardState", () => {
  it("returns annotated objects and connectors", async () => {
    const objectData = [
      {
        id: "obj-1",
        type: "sticky",
        x: 0,
        y: 0,
        width: 150,
        height: 150,
        color: "#A855F7",
        text: "Note",
        rotation: 0,
        z_index: 1,
        parent_frame_id: null,
      },
    ];

    const connectorData = [
      {
        id: "conn-1",
        from_id: "obj-1",
        to_id: "obj-2",
        style: "arrow",
        color: null,
        stroke_width: null,
      },
    ];

    // fetchBoardState calls Promise.all with two supabase queries.
    // Each produces .from().select().eq() — the terminal .eq() must resolve.
    // We use mockSupabase.from to return different chains per call.
    const objChain = freshChain();
    const connChain = freshChain();

    objChain.eq.mockResolvedValueOnce({ data: objectData, error: null });
    connChain.eq.mockResolvedValueOnce({ data: connectorData, error: null });

    let callIdx = 0;
    mockSupabase.from.mockImplementation(() => {
      callIdx++;
      return callIdx === 1 ? objChain : connChain;
    });

    const result = await fetchBoardState(BOARD_ID);

    expect(result.objectCount).toBe(1);
    expect(result.connectorCount).toBe(1);
    expect(result.objects[0].color).toContain("purple");
    expect(result.objects[0].color).toContain("#A855F7");
    expect(result.connectors[0]).toEqual(
      expect.objectContaining({
        id: "conn-1",
        fromId: "obj-1",
        toId: "obj-2",
        style: "arrow",
      }),
    );
  });
});
