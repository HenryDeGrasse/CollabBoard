export type VerticalAlign = "top" | "middle" | "bottom";

interface PaddingTopInput {
  text: string;
  boxWidth: number;
  boxHeight: number;
  scaledFontSize: number;
  vAlign: VerticalAlign;
}

/**
 * Estimate the textarea top padding needed to visually match canvas vertical alignment.
 *
 * Notes:
 * - We approximate wrapped line count using character width heuristics.
 * - We clamp content height to box height to avoid negative padding.
 * - "top" always returns 0.
 */
export function estimateVerticalPaddingTop({
  text,
  boxWidth,
  boxHeight,
  scaledFontSize,
  vAlign,
}: PaddingTopInput): number {
  if (vAlign === "top") return 0;
  if (boxHeight <= 0 || boxWidth <= 0 || scaledFontSize <= 0) return 0;

  const lineHeight = scaledFontSize * 1.4;
  const charsPerLine = Math.max(1, Math.floor(boxWidth / (scaledFontSize * 0.55)));
  const lineCount = Math.max(1, Math.ceil((text || "A").length / charsPerLine));
  const contentHeight = Math.min(lineCount * lineHeight, boxHeight);

  if (vAlign === "middle") {
    return Math.max(0, (boxHeight - contentHeight) / 2);
  }

  // bottom
  return Math.max(0, boxHeight - contentHeight);
}
