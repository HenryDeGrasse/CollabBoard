import { describe, it, expect } from "vitest";
import { calculateFontSize } from "../../utils/text-fit";

describe("calculateFontSize", () => {
  it("returns default size for empty text", () => {
    expect(calculateFontSize("", 150, 150)).toBe(14);
  });

  it("returns a number within min/max bounds", () => {
    const size = calculateFontSize("Hello World", 150, 150);
    expect(size).toBeGreaterThanOrEqual(10);
    expect(size).toBeLessThanOrEqual(48);
  });

  it("returns larger font for shorter text", () => {
    const short = calculateFontSize("Hi", 200, 200);
    const long = calculateFontSize("This is a much longer piece of text that should be smaller", 200, 200);
    expect(short).toBeGreaterThan(long);
  });

  it("returns larger font for bigger containers", () => {
    const small = calculateFontSize("Hello World", 100, 100);
    const large = calculateFontSize("Hello World", 400, 400);
    expect(large).toBeGreaterThan(small);
  });

  it("returns minFontSize when container is tiny", () => {
    const size = calculateFontSize("Hello World", 30, 30, 20, 10, 48);
    expect(size).toBe(10);
  });

  it("handles multiline text", () => {
    const multiline = calculateFontSize("Line 1\nLine 2\nLine 3", 200, 200);
    const singleline = calculateFontSize("Line 1 Line 2 Line 3", 200, 200);
    // Multiline should produce a different (usually smaller) size
    expect(multiline).toBeGreaterThan(0);
    expect(singleline).toBeGreaterThan(0);
  });

  it("respects custom min and max", () => {
    const size = calculateFontSize("A", 1000, 1000, 20, 12, 36);
    expect(size).toBeLessThanOrEqual(36);
    expect(size).toBeGreaterThanOrEqual(12);
  });

  it("handles zero-size container gracefully", () => {
    const size = calculateFontSize("Hello", 0, 0);
    expect(size).toBe(10); // returns minFontSize
  });
});
