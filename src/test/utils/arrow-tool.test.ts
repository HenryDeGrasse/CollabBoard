/**
 * Tests for the unified connector tool state-machine (arrow + line).
 *
 * Both the Arrow and Line tools now use the same click-click mechanism:
 *   1. Click empty canvas → free-floating start point
 *   2. Click an object   → snap/pin to that object
 *   3. Second click      → place end (free or snapped) and create connector
 *
 * The only difference is `style: "arrow" | "line"`.
 */
import { describe, it, expect } from "vitest";
import type { Connector } from "../../types/board";

// ─── State machine that mirrors Board.tsx logic exactly ──────────────────────

type ConnectorDraw = {
  fromId: string; // "" = free-floating
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  style: "arrow" | "line";
} | null;

interface MachineState {
  connectorDraw: ConnectorDraw;
  createdConnectors: Omit<Connector, "id">[];
  toolReset: number;
}

function makeMachine(style: "arrow" | "line") {
  const state: MachineState = {
    connectorDraw: null,
    createdConnectors: [],
    toolReset: 0,
  };

  const onCreateConnector = (conn: Omit<Connector, "id">) => {
    state.createdConnectors.push(conn);
  };
  const onResetTool = () => { state.toolReset++; };

  /** Stage click — empty canvas */
  function stageClick(x: number, y: number) {
    if (!state.connectorDraw) {
      state.connectorDraw = { fromId: "", fromX: x, fromY: y, toX: x, toY: y, style };
    } else {
      const fromPoint = state.connectorDraw.fromId === ""
        ? { x: state.connectorDraw.fromX, y: state.connectorDraw.fromY }
        : undefined;
      onCreateConnector({
        fromId: state.connectorDraw.fromId,
        toId: "",
        style: state.connectorDraw.style,
        fromPoint,
        toPoint: { x, y },
      });
      state.connectorDraw = null;
      onResetTool();
    }
  }

  /** Object click — snap */
  function objectClick(id: string, cx: number, cy: number) {
    if (!state.connectorDraw) {
      state.connectorDraw = { fromId: id, fromX: cx, fromY: cy, toX: cx, toY: cy, style };
    } else {
      if (state.connectorDraw.fromId === id) {
        state.connectorDraw = null;
        return;
      }
      const fromPoint = state.connectorDraw.fromId === ""
        ? { x: state.connectorDraw.fromX, y: state.connectorDraw.fromY }
        : undefined;
      onCreateConnector({
        fromId: state.connectorDraw.fromId,
        toId: id,
        style: state.connectorDraw.style,
        fromPoint,
      });
      state.connectorDraw = null;
      onResetTool();
    }
  }

  /** mousedown on stage — should be no-op for connector tools */
  function mouseDown() { /* no-op */ }

  /** Escape */
  function escape() { state.connectorDraw = null; }

  return { state, stageClick, objectClick, mouseDown, escape };
}

// ─── Tests (run once for each style) ─────────────────────────────────────────

describe.each(["arrow", "line"] as const)("Connector tool (%s)", (style) => {
  it("first stage click starts a free-floating draw", () => {
    const m = makeMachine(style);
    m.stageClick(100, 200);
    expect(m.state.connectorDraw).not.toBeNull();
    expect(m.state.connectorDraw!.fromId).toBe("");
    expect(m.state.connectorDraw!.style).toBe(style);
  });

  it("second stage click completes a free→free connector and resets tool", () => {
    const m = makeMachine(style);
    m.stageClick(100, 200);
    m.stageClick(400, 300);
    expect(m.state.connectorDraw).toBeNull();
    expect(m.state.createdConnectors).toHaveLength(1);
    expect(m.state.toolReset).toBe(1);

    const conn = m.state.createdConnectors[0];
    expect(conn.fromId).toBe("");
    expect(conn.toId).toBe("");
    expect(conn.style).toBe(style);
    expect(conn.fromPoint).toEqual({ x: 100, y: 200 });
    expect(conn.toPoint).toEqual({ x: 400, y: 300 });
  });

  it("mousedown+click does NOT create an infinite loop", () => {
    const m = makeMachine(style);
    m.mouseDown(); m.stageClick(100, 200); // first
    expect(m.state.connectorDraw).not.toBeNull();
    m.mouseDown(); m.stageClick(400, 300); // second
    expect(m.state.connectorDraw).toBeNull();
    expect(m.state.createdConnectors).toHaveLength(1);
  });

  it("clicking an object starts a pinned draw", () => {
    const m = makeMachine(style);
    m.objectClick("A", 50, 50);
    expect(m.state.connectorDraw!.fromId).toBe("A");
  });

  it("object → object creates a pinned connector", () => {
    const m = makeMachine(style);
    m.objectClick("A", 50, 50);
    m.objectClick("B", 200, 200);
    expect(m.state.connectorDraw).toBeNull();
    expect(m.state.createdConnectors).toHaveLength(1);

    const conn = m.state.createdConnectors[0];
    expect(conn.fromId).toBe("A");
    expect(conn.toId).toBe("B");
    expect(conn.style).toBe(style);
    expect(conn.fromPoint).toBeUndefined();
  });

  it("clicking the same object cancels (no connector)", () => {
    const m = makeMachine(style);
    m.objectClick("A", 50, 50);
    m.objectClick("A", 50, 50);
    expect(m.state.connectorDraw).toBeNull();
    expect(m.state.createdConnectors).toHaveLength(0);
  });

  it("free start → object end", () => {
    const m = makeMachine(style);
    m.stageClick(10, 20);
    m.objectClick("B", 300, 400);
    const conn = m.state.createdConnectors[0];
    expect(conn.fromId).toBe("");
    expect(conn.toId).toBe("B");
    expect(conn.fromPoint).toEqual({ x: 10, y: 20 });
    expect(conn.toPoint).toBeUndefined();
  });

  it("object start → free end", () => {
    const m = makeMachine(style);
    m.objectClick("A", 50, 60);
    m.stageClick(500, 600);
    const conn = m.state.createdConnectors[0];
    expect(conn.fromId).toBe("A");
    expect(conn.toId).toBe("");
    expect(conn.fromPoint).toBeUndefined();
    expect(conn.toPoint).toEqual({ x: 500, y: 600 });
  });

  it("Escape cancels without creating a connector", () => {
    const m = makeMachine(style);
    m.stageClick(100, 100);
    m.escape();
    expect(m.state.connectorDraw).toBeNull();
    expect(m.state.createdConnectors).toHaveLength(0);
  });

  it("multiple consecutive draws produce exactly one connector each", () => {
    const m = makeMachine(style);
    m.objectClick("A", 50, 50); m.objectClick("B", 200, 200);
    m.stageClick(0, 0); m.stageClick(300, 300);
    expect(m.state.createdConnectors).toHaveLength(2);
    expect(m.state.toolReset).toBe(2);
  });
});

// ─── dbToConnector round-trip ────────────────────────────────────────────────

describe("dbToConnector mapping", () => {
  function dbToConnector(row: any) {
    return {
      id: row.id,
      fromId: row.from_id ?? "",
      toId: row.to_id ?? "",
      style: row.style as "arrow" | "line",
      fromPoint: row.from_point ?? undefined,
      toPoint: row.to_point ?? undefined,
    };
  }

  it("fully-pinned connector (both IDs)", () => {
    const c = dbToConnector({ id: "1", from_id: "A", to_id: "B", style: "arrow", from_point: null, to_point: null });
    expect(c.fromId).toBe("A");
    expect(c.toId).toBe("B");
    expect(c.fromPoint).toBeUndefined();
  });

  it("free→free connector (both IDs null)", () => {
    const c = dbToConnector({ id: "2", from_id: null, to_id: null, style: "line", from_point: { x: 10, y: 20 }, to_point: { x: 100, y: 200 } });
    expect(c.fromId).toBe("");
    expect(c.toId).toBe("");
    expect(c.fromPoint).toEqual({ x: 10, y: 20 });
    expect(c.toPoint).toEqual({ x: 100, y: 200 });
  });

  it("mixed connector (pinned source, free end)", () => {
    const c = dbToConnector({ id: "3", from_id: "A", to_id: null, style: "arrow", from_point: null, to_point: { x: 500, y: 600 } });
    expect(c.fromId).toBe("A");
    expect(c.toId).toBe("");
    expect(c.toPoint).toEqual({ x: 500, y: 600 });
  });

  it("null id doesn't become the string 'null'", () => {
    const c = dbToConnector({ id: "c", from_id: null, to_id: null, style: "arrow", from_point: null, to_point: null });
    expect(c.fromId).not.toBe("null");
    expect(c.toId).not.toBe("null");
  });
});

// ─── ConnectorLine point resolution ──────────────────────────────────────────

describe("ConnectorLine point resolution", () => {
  type Pt = { x: number; y: number };
  interface Obj { x: number; y: number; width: number; height: number; type: string }

  function getEdgePoint(obj: Obj, targetX: number, targetY: number): Pt {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const hw = obj.width / 2; const hh = obj.height / 2;
    const scale = Math.abs(dx) * hh > Math.abs(dy) * hw ? hw / Math.abs(dx) : hh / Math.abs(dy);
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  function resolve(connector: Partial<Connector>, fromObj?: Obj, toObj?: Obj) {
    const from: Pt = fromObj
      ? getEdgePoint(fromObj, toObj ? toObj.x + toObj.width / 2 : (connector.toPoint?.x ?? 0), toObj ? toObj.y + toObj.height / 2 : (connector.toPoint?.y ?? 0))
      : connector.fromPoint ?? { x: 0, y: 0 };
    const to: Pt = toObj
      ? getEdgePoint(toObj, fromObj ? fromObj.x + fromObj.width / 2 : (connector.fromPoint?.x ?? 0), fromObj ? fromObj.y + fromObj.height / 2 : (connector.fromPoint?.y ?? 0))
      : connector.toPoint ?? { x: 0, y: 0 };
    return { from, to };
  }

  const A: Obj = { x: 0, y: 0, width: 100, height: 100, type: "rectangle" };
  const B: Obj = { x: 200, y: 0, width: 100, height: 100, type: "rectangle" };

  it("pinned→pinned snaps to edges", () => {
    const p = resolve({}, A, B);
    expect(p.from.x).toBeCloseTo(100);
    expect(p.to.x).toBeCloseTo(200);
  });

  it("free→free uses raw points", () => {
    const p = resolve({ fromPoint: { x: 10, y: 20 }, toPoint: { x: 300, y: 400 } });
    expect(p.from).toEqual({ x: 10, y: 20 });
    expect(p.to).toEqual({ x: 300, y: 400 });
  });

  it("pinned source, free end snaps source edge", () => {
    const p = resolve({ toPoint: { x: 500, y: 50 } }, A);
    expect(p.from.x).toBeCloseTo(100);
    expect(p.to).toEqual({ x: 500, y: 50 });
  });

  it("free start, pinned end snaps target edge", () => {
    const p = resolve({ fromPoint: { x: -100, y: 50 } }, undefined, B);
    expect(p.to.x).toBeCloseTo(200);
    expect(p.from).toEqual({ x: -100, y: 50 });
  });
});
