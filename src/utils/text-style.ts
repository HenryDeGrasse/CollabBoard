import type { BoardObject, ObjectType } from "../types/board";
import { calculateFontSize } from "./text-fit";

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
