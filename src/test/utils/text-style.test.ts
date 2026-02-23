import { describe, it, expect } from "vitest";

import {
  isTextCapableObjectType,
  getAutoContrastingTextColor,
  getFrameAutoTitleFontSize,
  clampTextSizeForType,
  getFrameTitleFontSize,
  getFrameHeaderHeight,
  getAutoTextSize,
  resolveObjectTextSize,
  FRAME_TITLE_FONT_MIN,
  FRAME_TITLE_FONT_MAX,
  FRAME_HEADER_MIN_HEIGHT,
  FRAME_HEADER_MAX_HEIGHT,
} from "../../utils/text";
import { calculateFontSize } from "../../utils/text";
import type { BoardObject } from "../../types/board";

function makeObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: "obj-1",
    type: "sticky",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    color: "#FBBF24",
    text: "Hello",
    rotation: 0,
    zIndex: 1,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("isTextCapableObjectType", () => {
  it("returns true for sticky, rectangle, circle, frame, text", () => {
    expect(isTextCapableObjectType("sticky")).toBe(true);
    expect(isTextCapableObjectType("rectangle")).toBe(true);
    expect(isTextCapableObjectType("circle")).toBe(true);
    expect(isTextCapableObjectType("frame")).toBe(true);
    expect(isTextCapableObjectType("text")).toBe(true);
  });

  it("returns false for line", () => {
    expect(isTextCapableObjectType("line")).toBe(false);
  });
});

describe("getAutoContrastingTextColor", () => {
  it("returns dark text on white background", () => {
    expect(getAutoContrastingTextColor("#FFFFFF")).toBe("#1F2937");
  });

  it("returns light text on black background", () => {
    expect(getAutoContrastingTextColor("#000000")).toBe("#FFFFFF");
  });

  it("returns dark text on yellow (light) background", () => {
    expect(getAutoContrastingTextColor("#FBBF24")).toBe("#1F2937");
  });

  it("returns light text on dark blue background", () => {
    expect(getAutoContrastingTextColor("#1E3A5F")).toBe("#FFFFFF");
  });

  it("accepts hex without # prefix", () => {
    expect(getAutoContrastingTextColor("FFFFFF")).toBe("#1F2937");
  });

  it("returns dark default for short/malformed hex", () => {
    expect(getAutoContrastingTextColor("#FFF")).toBe("#1F2937");
    expect(getAutoContrastingTextColor("abc")).toBe("#1F2937");
  });

  it("accepts custom dark/light overrides", () => {
    expect(getAutoContrastingTextColor("#FFFFFF", "#000", "#FFF")).toBe("#000");
    expect(getAutoContrastingTextColor("#000000", "#000", "#FFF")).toBe("#FFF");
  });
});

describe("getFrameAutoTitleFontSize", () => {
  it("returns FRAME_TITLE_FONT_MIN for very narrow frames", () => {
    expect(getFrameAutoTitleFontSize(100)).toBe(FRAME_TITLE_FONT_MIN);
  });

  it("returns 14 (max) for wide frames", () => {
    expect(getFrameAutoTitleFontSize(500)).toBe(14);
  });

  it("returns width / 20 for mid-range widths", () => {
    // width=240 => 240/20 = 12
    expect(getFrameAutoTitleFontSize(240)).toBe(12);
  });
});

describe("clampTextSizeForType", () => {
  it("clamps frame type within [FRAME_TITLE_FONT_MIN, FRAME_TITLE_FONT_MAX]", () => {
    expect(clampTextSizeForType("frame", 5)).toBe(FRAME_TITLE_FONT_MIN);
    expect(clampTextSizeForType("frame", 50)).toBe(FRAME_TITLE_FONT_MAX);
    expect(clampTextSizeForType("frame", 15)).toBe(15);
  });

  it("clamps non-frame types within [9, 48]", () => {
    expect(clampTextSizeForType("sticky", 3)).toBe(9);
    expect(clampTextSizeForType("sticky", 100)).toBe(48);
    expect(clampTextSizeForType("rectangle", 20)).toBe(20);
  });

  it("returns default for NaN", () => {
    expect(clampTextSizeForType("frame", NaN)).toBe(12);
    expect(clampTextSizeForType("sticky", NaN)).toBe(14);
  });

  it("returns default for Infinity", () => {
    expect(clampTextSizeForType("frame", Infinity)).toBe(12);
    expect(clampTextSizeForType("sticky", Infinity)).toBe(14);
  });

  it("rounds to nearest integer", () => {
    expect(clampTextSizeForType("sticky", 15.7)).toBe(16);
    expect(clampTextSizeForType("sticky", 15.3)).toBe(15);
  });
});

describe("getFrameTitleFontSize", () => {
  it("uses explicit textSize when provided", () => {
    expect(getFrameTitleFontSize({ width: 200, textSize: 18 })).toBe(18);
  });

  it("falls back to auto calculation when textSize is undefined", () => {
    const result = getFrameTitleFontSize({ width: 240, textSize: undefined });
    // width/20 = 12, clamped for frame => 12
    expect(result).toBe(12);
  });

  it("clamps explicit textSize to frame bounds", () => {
    expect(getFrameTitleFontSize({ width: 200, textSize: 50 })).toBe(FRAME_TITLE_FONT_MAX);
    expect(getFrameTitleFontSize({ width: 200, textSize: 3 })).toBe(FRAME_TITLE_FONT_MIN);
  });
});

describe("getFrameHeaderHeight", () => {
  it("returns at least FRAME_HEADER_MIN_HEIGHT", () => {
    const result = getFrameHeaderHeight({ width: 100, textSize: 10 });
    // fontSize=10, 10*1.8=18, clamped to min 32
    expect(result).toBe(FRAME_HEADER_MIN_HEIGHT);
  });

  it("returns at most FRAME_HEADER_MAX_HEIGHT", () => {
    const result = getFrameHeaderHeight({ width: 200, textSize: 22 });
    // fontSize=22, 22*1.8=39.6, round=40, clamped to max 52
    expect(result).toBeLessThanOrEqual(FRAME_HEADER_MAX_HEIGHT);
    expect(result).toBeGreaterThanOrEqual(FRAME_HEADER_MIN_HEIGHT);
  });

  it("scales proportionally with font size", () => {
    const small = getFrameHeaderHeight({ width: 200, textSize: 12 });
    const large = getFrameHeaderHeight({ width: 200, textSize: 20 });
    expect(large).toBeGreaterThan(small);
  });
});

describe("getAutoTextSize", () => {
  it("returns frame auto title font size for frames", () => {
    const result = getAutoTextSize(makeObject({ type: "frame", width: 240 }));
    expect(result).toBe(12); // 240/20 = 12
  });

  it("uses calculateFontSize parameters for sticky notes", () => {
    const result = getAutoTextSize(makeObject({ type: "sticky", text: "Test", width: 150, height: 150 }));
    const expected = calculateFontSize("Test", 150, 150, 12, 10, 32);
    expect(result).toBe(expected);
  });

  it("uses calculateFontSize parameters for rectangles", () => {
    const result = getAutoTextSize(makeObject({ type: "rectangle", text: "Test", width: 200, height: 100 }));
    const expected = calculateFontSize("Test", 200, 100, 10, 9, 28);
    expect(result).toBe(expected);
  });

  it("uses inscribed-square sizing for circles", () => {
    const obj = makeObject({ type: "circle", text: "Test", width: 100, height: 100 });
    const result = getAutoTextSize(obj);
    const r = 50; // min(100,100)/2
    const side = r * Math.sqrt(2);
    const expected = calculateFontSize("Test", side, side, 8, 9, 28);
    expect(result).toBe(expected);
  });

  it("returns 16 for text type", () => {
    expect(getAutoTextSize(makeObject({ type: "text" }))).toBe(16);
  });

  it("returns 14 for unknown/fallback types", () => {
    expect(getAutoTextSize(makeObject({ type: "line" }))).toBe(14);
  });

  it("uses empty string when text is undefined", () => {
    const result = getAutoTextSize(makeObject({ type: "sticky", text: undefined }));
    const expected = calculateFontSize("", 200, 200, 12, 10, 32);
    expect(result).toBe(expected);
  });
});

describe("resolveObjectTextSize", () => {
  it("uses explicit textSize when present", () => {
    const result = resolveObjectTextSize(makeObject({ type: "sticky", textSize: 20 }));
    expect(result).toBe(20);
  });

  it("falls back to auto size when textSize is null/undefined", () => {
    const expectedAuto = calculateFontSize("Hello", 200, 200, 12, 10, 32);
    const result = resolveObjectTextSize(makeObject({ type: "sticky", textSize: undefined }));
    expect(result).toBe(clampTextSizeForType("sticky", expectedAuto));
  });

  it("clamps the result to type-specific bounds", () => {
    const result = resolveObjectTextSize(makeObject({ type: "sticky", textSize: 100 }));
    expect(result).toBe(48); // max for non-frame
  });

  it("clamps frame textSize to frame bounds", () => {
    const result = resolveObjectTextSize(makeObject({ type: "frame", textSize: 100 }));
    expect(result).toBe(FRAME_TITLE_FONT_MAX);
  });
});
