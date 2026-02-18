import { describe, expect, it } from "vitest";
import { estimateVerticalPaddingTop } from "../../utils/text-overlay-layout";

describe("estimateVerticalPaddingTop", () => {
  const base = {
    text: "Hello world",
    boxWidth: 200,
    boxHeight: 100,
    scaledFontSize: 16,
  };

  it("returns 0 for top alignment", () => {
    expect(
      estimateVerticalPaddingTop({
        ...base,
        vAlign: "top",
      })
    ).toBe(0);
  });

  it("returns positive center padding for middle alignment", () => {
    const pad = estimateVerticalPaddingTop({
      ...base,
      vAlign: "middle",
    });
    expect(pad).toBeGreaterThan(0);
    expect(pad).toBeLessThan(base.boxHeight / 2);
  });

  it("returns larger padding for bottom alignment than middle", () => {
    const middle = estimateVerticalPaddingTop({
      ...base,
      vAlign: "middle",
    });
    const bottom = estimateVerticalPaddingTop({
      ...base,
      vAlign: "bottom",
    });

    expect(bottom).toBeGreaterThan(middle);
  });

  it("clamps to 0 when content height exceeds box height", () => {
    const pad = estimateVerticalPaddingTop({
      text: "x".repeat(800),
      boxWidth: 80,
      boxHeight: 40,
      scaledFontSize: 18,
      vAlign: "bottom",
    });

    expect(pad).toBe(0);
  });

  it("handles invalid dimensions safely", () => {
    expect(
      estimateVerticalPaddingTop({
        ...base,
        boxWidth: 0,
        vAlign: "middle",
      })
    ).toBe(0);
    expect(
      estimateVerticalPaddingTop({
        ...base,
        boxHeight: -1,
        vAlign: "bottom",
      })
    ).toBe(0);
    expect(
      estimateVerticalPaddingTop({
        ...base,
        scaledFontSize: 0,
        vAlign: "middle",
      })
    ).toBe(0);
  });
});
