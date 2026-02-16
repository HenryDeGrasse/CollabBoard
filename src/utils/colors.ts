export const STICKY_COLORS = {
  yellow: "#FBBF24",
  pink: "#F472B6",
  blue: "#3B82F6",
  green: "#22C55E",
  orange: "#F97316",
  purple: "#A855F7",
} as const;

export const SHAPE_COLORS = {
  red: "#EF4444",
  blue: "#3B82F6",
  green: "#22C55E",
  yellow: "#FBBF24",
  gray: "#9CA3AF",
  black: "#1F2937",
} as const;

export const CURSOR_COLORS = [
  "#EF4444", // red
  "#3B82F6", // blue
  "#22C55E", // green
  "#F97316", // orange
  "#A855F7", // purple
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F59E0B", // amber
] as const;

export const DEFAULT_STICKY_COLOR = STICKY_COLORS.yellow;
export const DEFAULT_SHAPE_COLOR = SHAPE_COLORS.blue;

export function getRandomCursorColor(index: number): string {
  return CURSOR_COLORS[index % CURSOR_COLORS.length];
}

export function getStickyColorArray(): string[] {
  return Object.values(STICKY_COLORS);
}

export function getShapeColorArray(): string[] {
  return Object.values(SHAPE_COLORS);
}
