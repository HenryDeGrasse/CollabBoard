import { describe, it, expect } from "vitest";
import { computeResize } from "../../components/canvas/ResizeHandles";

describe("computeResize", () => {
  const original = { x: 100, y: 100, width: 200, height: 150 };

  describe("corner handles", () => {
    it("bottom-right: expands width and height", () => {
      const result = computeResize(original, "bottom-right", 400, 350);
      expect(result).toEqual({ x: 100, y: 100, width: 300, height: 250 });
    });

    it("top-left: moves origin and resizes", () => {
      const result = computeResize(original, "top-left", 50, 50);
      expect(result).toEqual({ x: 50, y: 50, width: 250, height: 200 });
    });

    it("top-right: moves y origin, expands width", () => {
      const result = computeResize(original, "top-right", 400, 50);
      expect(result).toEqual({ x: 100, y: 50, width: 300, height: 200 });
    });

    it("bottom-left: moves x origin, expands height", () => {
      const result = computeResize(original, "bottom-left", 50, 350);
      expect(result).toEqual({ x: 50, y: 100, width: 250, height: 250 });
    });
  });

  describe("edge handles", () => {
    it("right: changes only width", () => {
      const result = computeResize(original, "right", 400, 175);
      expect(result.width).toBe(300);
      expect(result.height).toBe(150);
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it("bottom: changes only height", () => {
      const result = computeResize(original, "bottom", 200, 400);
      expect(result.width).toBe(200);
      expect(result.height).toBe(300);
    });

    it("left: changes x and width", () => {
      const result = computeResize(original, "left", 50, 175);
      expect(result.x).toBe(50);
      expect(result.width).toBe(250);
      expect(result.height).toBe(150);
    });

    it("top: changes y and height", () => {
      const result = computeResize(original, "top", 200, 50);
      expect(result.y).toBe(50);
      expect(result.height).toBe(200);
      expect(result.width).toBe(200);
    });
  });

  describe("minimum size enforcement", () => {
    it("enforces minimum width", () => {
      const result = computeResize(original, "right", 110, 175, 40, 40);
      expect(result.width).toBe(40);
    });

    it("enforces minimum height", () => {
      const result = computeResize(original, "bottom", 200, 110, 40, 40);
      expect(result.height).toBe(40);
    });

    it("left handle: adjusts x when hitting minimum width", () => {
      const result = computeResize(original, "left", 299, 175, 40, 40);
      expect(result.width).toBe(40);
      expect(result.x).toBe(260); // original.x + original.width - minWidth
    });

    it("top handle: adjusts y when hitting minimum height", () => {
      const result = computeResize(original, "top", 200, 249, 40, 40);
      expect(result.height).toBe(40);
      expect(result.y).toBe(210); // original.y + original.height - minHeight
    });
  });

  describe("keepAspect (square/circle mode)", () => {
    it("forces square dimensions from bottom-right", () => {
      const result = computeResize(original, "bottom-right", 400, 300, 40, 40, true);
      // width=300, height=200 → max=300
      expect(result.width).toBe(300);
      expect(result.height).toBe(300);
    });

    it("forces square dimensions from top-left", () => {
      const squareOriginal = { x: 100, y: 100, width: 100, height: 100 };
      const result = computeResize(squareOriginal, "top-left", 50, 70, 40, 40, true);
      // width=150, height=130 → max=150
      expect(result.width).toBe(150);
      expect(result.height).toBe(150);
    });

    it("forces equal dimensions from edge handle", () => {
      const result = computeResize(original, "right", 500, 175, 40, 40, true);
      // width=400 > height=150 → both become 400
      expect(result.width).toBe(result.height);
    });
  });
});
