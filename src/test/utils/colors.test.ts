import { describe, it, expect } from "vitest";
import {
  getStickyColorArray,
  getShapeColorArray,
  getRandomCursorColor,
  DEFAULT_STICKY_COLOR,
  DEFAULT_SHAPE_COLOR,
  STICKY_COLORS,
  SHAPE_COLORS,
  CURSOR_COLORS,
} from "../../utils/colors";

describe("colors utility", () => {
  describe("STICKY_COLORS", () => {
    it("contains expected color keys", () => {
      expect(STICKY_COLORS).toHaveProperty("yellow");
      expect(STICKY_COLORS).toHaveProperty("pink");
      expect(STICKY_COLORS).toHaveProperty("blue");
    });

    it("values are hex color strings", () => {
      Object.values(STICKY_COLORS).forEach((c) => {
        expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe("SHAPE_COLORS", () => {
    it("contains expected color keys", () => {
      expect(SHAPE_COLORS).toHaveProperty("red");
      expect(SHAPE_COLORS).toHaveProperty("blue");
      expect(SHAPE_COLORS).toHaveProperty("black");
    });

    it("values are hex color strings", () => {
      Object.values(SHAPE_COLORS).forEach((c) => {
        expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe("getStickyColorArray", () => {
    it("returns an array of all sticky colors", () => {
      const colors = getStickyColorArray();
      expect(colors).toEqual(Object.values(STICKY_COLORS));
    });

    it("returns hex strings", () => {
      getStickyColorArray().forEach((c) => {
        expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe("getShapeColorArray", () => {
    it("returns an array of all shape colors", () => {
      const colors = getShapeColorArray();
      expect(colors).toEqual(Object.values(SHAPE_COLORS));
    });
  });

  describe("DEFAULT_STICKY_COLOR", () => {
    it("is the yellow sticky color", () => {
      expect(DEFAULT_STICKY_COLOR).toBe(STICKY_COLORS.yellow);
    });

    it("is in the sticky color array", () => {
      expect(getStickyColorArray()).toContain(DEFAULT_STICKY_COLOR);
    });
  });

  describe("DEFAULT_SHAPE_COLOR", () => {
    it("is the black shape color", () => {
      expect(DEFAULT_SHAPE_COLOR).toBe(SHAPE_COLORS.black);
    });

    it("is in the shape color array", () => {
      expect(getShapeColorArray()).toContain(DEFAULT_SHAPE_COLOR);
    });
  });

  describe("getRandomCursorColor", () => {
    it("returns a color from CURSOR_COLORS", () => {
      for (let i = 0; i < 20; i++) {
        const color = getRandomCursorColor(i);
        expect(CURSOR_COLORS as readonly string[]).toContain(color);
      }
    });

    it("wraps around for indices beyond array length", () => {
      const color0 = getRandomCursorColor(0);
      const colorWrap = getRandomCursorColor(CURSOR_COLORS.length);
      expect(color0).toBe(colorWrap);
    });

    it("returns different colors for different indices", () => {
      const color0 = getRandomCursorColor(0);
      const color1 = getRandomCursorColor(1);
      expect(color0).not.toBe(color1);
    });
  });
});
