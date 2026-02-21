export const STICKY_COLORS = {
  yellow: "#FAD84E",   // Post-it yellow (more saturated)
  pink: "#F5A8C4",     // Post-it pink
  blue: "#7FC8E8",     // Post-it blue
  green: "#9DD9A3",    // Post-it green
  grey: "#E5E5E0",     // Newsprint divider grey
  offwhite: "#F9F9F7", // Newsprint background
} as const;

export const SHAPE_COLORS = {
  black: "#111111",     // Ink black
  darkgrey: "#404040",  // Neutral 700
  grey: "#E5E5E0",      // Divider grey
  offwhite: "#F9F9F7",  // Newsprint background
  red: "#CC0000",       // Editorial Red
  blue: "#3B82F6",      // Standard blue (for markup/diagrams)
} as const;

export const CURSOR_COLORS = [
  "#CC0000", // Editorial Red
  "#111111", // Ink Black
  "#404040", // Neutral 700
  "#525252", // Neutral 600
  "#737373", // Neutral 500
  "#A3A3A3", // Neutral 400
] as const;

export const DEFAULT_STICKY_COLOR = STICKY_COLORS.yellow;
export const DEFAULT_SHAPE_COLOR = SHAPE_COLORS.black;

export function getRandomCursorColor(index: number): string {
  return CURSOR_COLORS[index % CURSOR_COLORS.length];
}

export function getStickyColorArray(): string[] {
  return Object.values(STICKY_COLORS);
}

export function getShapeColorArray(): string[] {
  return Object.values(SHAPE_COLORS);
}
