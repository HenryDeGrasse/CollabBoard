import type { BoardObject, ObjectType } from "../types/board";

/**
 * Calculate the best font size to fit text within a container.
 * Uses a simple heuristic based on character count and container area.
 */
export function calculateFontSize(
  text: string,
  containerWidth: number,
  containerHeight: number,
  padding: number = 20,
  minFontSize: number = 10,
  maxFontSize: number = 48
): number {
  if (!text || text.length === 0) return 14; // default

  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  if (availableWidth <= 0 || availableHeight <= 0) return minFontSize;

  const area = availableWidth * availableHeight;
  const charCount = text.length;

  // Approximate: each character takes roughly fontSize * fontSize * 0.6 area
  // Solve for fontSize: fontSize = sqrt(area / (charCount * 0.6))
  let fontSize = Math.sqrt(area / (charCount * 0.65));

  // Also constrain by width: the longest line shouldn't overflow
  const lines = text.split("\n");
  const longestLine = Math.max(...lines.map((l) => l.length));
  if (longestLine > 0) {
    const maxByWidth = availableWidth / (longestLine * 0.58);
    fontSize = Math.min(fontSize, maxByWidth);
  }

  // Constrain by height: total line count * lineHeight shouldn't overflow
  const estimatedLineHeight = fontSize * 1.4;
  const estimatedWrappedLines = lines.reduce((total, line) => {
    const charsPerLine = Math.max(1, Math.floor(availableWidth / (fontSize * 0.58)));
    return total + Math.max(1, Math.ceil(line.length / charsPerLine));
  }, 0);
  const totalTextHeight = estimatedWrappedLines * estimatedLineHeight;

  if (totalTextHeight > availableHeight) {
    fontSize *= availableHeight / totalTextHeight;
  }

  // Clamp
  fontSize = Math.max(minFontSize, Math.min(maxFontSize, fontSize));

  return Math.round(fontSize * 10) / 10; // round to 1 decimal
}

export const FRAME_TITLE_FONT_MIN = 10;
export const FRAME_TITLE_FONT_MAX = 22;
export const FRAME_HEADER_MIN_HEIGHT = 32;
export const FRAME_HEADER_MAX_HEIGHT = 52;

export function isTextCapableObjectType(type: ObjectType): boolean {
  return (
    type === "sticky" ||
    type === "rectangle" ||
    type === "circle" ||
    type === "frame" ||
    type === "text"
  );
}

export function getAutoContrastingTextColor(
  backgroundHex: string,
  dark = "#1F2937",
  light = "#FFFFFF"
): string {
  const hex = backgroundHex.replace("#", "");
  if (hex.length < 6) return dark;

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? dark : light;
}

export function getFrameAutoTitleFontSize(width: number): number {
  return Math.min(14, Math.max(FRAME_TITLE_FONT_MIN, width / 20));
}

export function clampTextSizeForType(type: ObjectType, value: number): number {
  if (!Number.isFinite(value)) return type === "frame" ? 12 : 14;

  if (type === "frame") {
    return Math.min(FRAME_TITLE_FONT_MAX, Math.max(FRAME_TITLE_FONT_MIN, Math.round(value)));
  }

  return Math.min(48, Math.max(9, Math.round(value)));
}

export function getFrameTitleFontSize(object: Pick<BoardObject, "width" | "textSize">): number {
  const base =
    typeof object.textSize === "number"
      ? object.textSize
      : getFrameAutoTitleFontSize(object.width);
  return clampTextSizeForType("frame", base);
}

export function getFrameHeaderHeight(object: Pick<BoardObject, "width" | "textSize">): number {
  const fontSize = getFrameTitleFontSize(object);
  return Math.min(
    FRAME_HEADER_MAX_HEIGHT,
    Math.max(FRAME_HEADER_MIN_HEIGHT, Math.round(fontSize * 1.8))
  );
}

export function getAutoTextSize(object: BoardObject): number {
  if (object.type === "frame") {
    return getFrameAutoTitleFontSize(object.width);
  }

  if (object.type === "sticky") {
    return calculateFontSize(object.text || "", object.width, object.height, 12, 10, 32);
  }

  if (object.type === "rectangle") {
    return calculateFontSize(object.text || "", object.width, object.height, 10, 9, 28);
  }

  if (object.type === "circle") {
    const r = Math.min(object.width, object.height) / 2;
    const side = r * Math.sqrt(2);
    return calculateFontSize(object.text || "", side, side, 8, 9, 28);
  }

  if (object.type === "text") {
    return 16;
  }

  return 14;
}

export function resolveObjectTextSize(object: BoardObject): number {
  const base =
    typeof object.textSize === "number"
      ? object.textSize
      : getAutoTextSize(object);
  return clampTextSizeForType(object.type, base);
}

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
