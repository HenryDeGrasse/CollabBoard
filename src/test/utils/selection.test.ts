import { describe, it, expect } from "vitest";
import {
  getObjectIdsInRect,
  getConnectorIdsInRect,
  lineSegmentIntersectsRect,
} from "../../utils/selection";
import type { BoardObject, Connector } from "../../types/board";

function makeObj(id: string, x: number, y: number, w = 100, h = 100): BoardObject {
  return {
    id, type: "rectangle", x, y, width: w, height: h,
    color: "#fff", text: "", rotation: 0, zIndex: 1,
    createdBy: "u1", createdAt: 0, updatedAt: 0,
  };
}

function makeConn(id: string, fromId: string, toId: string): Connector {
  return { id, fromId, toId, style: "arrow" };
}

describe("lineSegmentIntersectsRect", () => {
  const rect = { x: 100, y: 100, width: 200, height: 200 }; // 100,100 → 300,300

  it("returns true when one endpoint is inside rect", () => {
    expect(lineSegmentIntersectsRect(50, 50, 150, 150, rect)).toBe(true);
  });

  it("returns true when segment crosses rect (neither endpoint inside)", () => {
    // Diagonal line from top-left outside to bottom-right outside, passing through rect
    expect(lineSegmentIntersectsRect(0, 200, 400, 200, rect)).toBe(true);
  });

  it("returns true when segment crosses rect vertically", () => {
    expect(lineSegmentIntersectsRect(200, 0, 200, 400, rect)).toBe(true);
  });

  it("returns false when segment is entirely outside", () => {
    expect(lineSegmentIntersectsRect(0, 0, 50, 50, rect)).toBe(false);
  });

  it("returns false when segment is above rect", () => {
    expect(lineSegmentIntersectsRect(100, 0, 300, 0, rect)).toBe(false);
  });
});

describe("getObjectIdsInRect", () => {
  it("selects objects that overlap the rect", () => {
    const objects: Record<string, BoardObject> = {
      a: makeObj("a", 50, 50),    // overlaps rect
      b: makeObj("b", 400, 400),  // outside
    };
    const rect = { x: 100, y: 100, width: 200, height: 200 };
    expect(getObjectIdsInRect(objects, rect)).toEqual(["a"]);
  });
});

describe("getConnectorIdsInRect — Bug: arrow-only selection", () => {
  // This is the core bug: user drags selection rect over an arrow
  // but NOT over either of its endpoint objects.
  // The connector's line segment passes through the selection rect.

  it("selects a connector whose line passes through the rect even when both endpoints are outside", () => {
    // Two objects far apart, connected by an arrow
    const objA = makeObj("objA", 0, 0, 50, 50);       // center: 25, 25
    const objB = makeObj("objB", 500, 500, 50, 50);    // center: 525, 525
    const objects: Record<string, BoardObject> = { objA, objB };
    const conn = makeConn("conn1", "objA", "objB");
    const connectors: Record<string, Connector> = { conn1: conn };

    // Selection rect covers the middle of the arrow but NOT objA or objB
    const rect = { x: 200, y: 200, width: 100, height: 100 };

    const result = getConnectorIdsInRect(connectors, objects, rect);
    expect(result).toContain("conn1");
  });

  it("does NOT select a connector whose line misses the rect entirely", () => {
    const objA = makeObj("objA", 0, 0, 50, 50);
    const objB = makeObj("objB", 0, 200, 50, 50);
    const objects: Record<string, BoardObject> = { objA, objB };
    const conn = makeConn("conn1", "objA", "objB");
    const connectors: Record<string, Connector> = { conn1: conn };

    // Rect far to the right, nowhere near the vertical connector line
    const rect = { x: 400, y: 0, width: 100, height: 100 };

    const result = getConnectorIdsInRect(connectors, objects, rect);
    expect(result).not.toContain("conn1");
  });

  it("selects connector when rect covers just one object but line passes through", () => {
    // Even if only one endpoint object overlaps, the connector line still intersects
    const objA = makeObj("objA", 150, 150, 50, 50);  // inside rect
    const objB = makeObj("objB", 500, 500, 50, 50);  // outside rect
    const objects: Record<string, BoardObject> = { objA, objB };
    const conn = makeConn("conn1", "objA", "objB");
    const connectors: Record<string, Connector> = { conn1: conn };

    const rect = { x: 100, y: 100, width: 200, height: 200 };

    const result = getConnectorIdsInRect(connectors, objects, rect);
    expect(result).toContain("conn1");
  });
});
