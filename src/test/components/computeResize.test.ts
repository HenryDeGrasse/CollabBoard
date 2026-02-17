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

  describe("shrinking objects", () => {
    it("bottom-right: shrinks width and height", () => {
      const result = computeResize(original, "bottom-right", 200, 180);
      expect(result.width).toBe(100);
      expect(result.height).toBe(80);
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it("top-left: shrinks by moving origin inward", () => {
      const result = computeResize(original, "top-left", 200, 180);
      expect(result.x).toBe(200);
      expect(result.y).toBe(180);
      expect(result.width).toBe(100);
      expect(result.height).toBe(70);
    });

    it("left: shrinks width by moving left edge right", () => {
      const result = computeResize(original, "left", 200, 175);
      expect(result.x).toBe(200);
      expect(result.width).toBe(100);
    });

    it("top: shrinks height by moving top edge down", () => {
      const result = computeResize(original, "top", 200, 180);
      expect(result.y).toBe(180);
      expect(result.height).toBe(70);
    });

    it("right: shrinks width", () => {
      const result = computeResize(original, "right", 200, 175);
      expect(result.width).toBe(100);
      expect(result.x).toBe(100);
    });

    it("bottom: shrinks height", () => {
      const result = computeResize(original, "bottom", 200, 180);
      expect(result.height).toBe(80);
      expect(result.y).toBe(100);
    });

    it("circle: shrinks with keepAspect from right handle", () => {
      const circleOrig = { x: 100, y: 100, width: 200, height: 200 };
      const result = computeResize(circleOrig, "right", 200, 200, 40, 40, true);
      // width = 200 - 100 = 100, height stays 200, max(100,200)=200... 
      // Actually with keepAspect from right: width = pointer - origX = 100
      // keepAspect: size = max(100, 200) = 200 — this is wrong!
      // When shrinking with aspect lock, we should use the handle's direction
      expect(result.width).toBe(result.height);
      expect(result.width).toBeLessThan(200);
    });

    it("circle: shrinks with keepAspect from bottom handle", () => {
      const circleOrig = { x: 100, y: 100, width: 200, height: 200 };
      const result = computeResize(circleOrig, "bottom", 200, 200, 40, 40, true);
      expect(result.width).toBe(result.height);
      expect(result.height).toBeLessThan(200);
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
