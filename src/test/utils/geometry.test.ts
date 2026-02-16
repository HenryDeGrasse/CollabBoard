import { describe, it, expect } from "vitest";
import { doBoxesIntersect, isPointInBox, getBoundingBox } from "../../utils/geometry";

describe("geometry utility", () => {
  describe("doBoxesIntersect", () => {
    it("returns true for overlapping boxes", () => {
      const a = { x: 0, y: 0, width: 100, height: 100 };
      const b = { x: 50, y: 50, width: 100, height: 100 };
      expect(doBoxesIntersect(a, b)).toBe(true);
    });

    it("returns true when one box contains another", () => {
      const outer = { x: 0, y: 0, width: 200, height: 200 };
      const inner = { x: 50, y: 50, width: 50, height: 50 };
      expect(doBoxesIntersect(outer, inner)).toBe(true);
      expect(doBoxesIntersect(inner, outer)).toBe(true);
    });

    it("returns false for non-overlapping boxes", () => {
      const a = { x: 0, y: 0, width: 50, height: 50 };
      const b = { x: 100, y: 100, width: 50, height: 50 };
      expect(doBoxesIntersect(a, b)).toBe(false);
    });

    it("returns false for adjacent boxes (touching edges)", () => {
      const a = { x: 0, y: 0, width: 50, height: 50 };
      const b = { x: 50, y: 0, width: 50, height: 50 };
      expect(doBoxesIntersect(a, b)).toBe(false);
    });

    it("returns true for boxes overlapping by 1px", () => {
      const a = { x: 0, y: 0, width: 51, height: 50 };
      const b = { x: 50, y: 0, width: 50, height: 50 };
      expect(doBoxesIntersect(a, b)).toBe(true);
    });
  });

  describe("isPointInBox", () => {
    const box = { x: 10, y: 20, width: 100, height: 50 };

    it("returns true for point inside box", () => {
      expect(isPointInBox(50, 40, box)).toBe(true);
    });

    it("returns true for point on edge", () => {
      expect(isPointInBox(10, 20, box)).toBe(true); // top-left corner
      expect(isPointInBox(110, 70, box)).toBe(true); // bottom-right corner
    });

    it("returns false for point outside box", () => {
      expect(isPointInBox(5, 40, box)).toBe(false);
      expect(isPointInBox(50, 80, box)).toBe(false);
      expect(isPointInBox(200, 200, box)).toBe(false);
    });
  });

  describe("getBoundingBox", () => {
    it("returns null for empty array", () => {
      expect(getBoundingBox([])).toBeNull();
    });

    it("returns the box itself for a single object", () => {
      const box = { x: 10, y: 20, width: 100, height: 50 };
      expect(getBoundingBox([box])).toEqual(box);
    });

    it("returns enclosing box for multiple objects", () => {
      const objects = [
        { x: 0, y: 0, width: 50, height: 50 },
        { x: 100, y: 100, width: 50, height: 50 },
      ];
      expect(getBoundingBox(objects)).toEqual({
        x: 0,
        y: 0,
        width: 150,
        height: 150,
      });
    });

    it("handles negative coordinates", () => {
      const objects = [
        { x: -50, y: -50, width: 50, height: 50 },
        { x: 50, y: 50, width: 50, height: 50 },
      ];
      expect(getBoundingBox(objects)).toEqual({
        x: -50,
        y: -50,
        width: 150,
        height: 150,
      });
    });
  });
});
