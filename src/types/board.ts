export type ObjectType = "sticky" | "rectangle" | "circle" | "line" | "frame" | "text";

export interface BoardObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  textSize?: number | null;
  textColor?: string | null;
  textVerticalAlign?: "top" | "middle" | "bottom" | null;
  rotation: number;
  zIndex: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  // Line-specific fields
  points?: number[]; // [x1, y1, x2, y2, ...] relative to object x,y
  strokeWidth?: number;
  // Frame grouping (explicit membership)
  parentFrameId?: string | null;
}

export interface Connector {
  id: string;
  /** ID of the source object, or empty string when the source is a free point */
  fromId: string;
  /** ID of the target object, or empty string when the target is a free point */
  toId: string;
  style: "arrow" | "line";
  points?: number[];
  /** Free-floating source anchor (used when fromId is empty) */
  fromPoint?: { x: number; y: number };
  /** Free-floating target anchor (used when toId is empty) */
  toPoint?: { x: number; y: number };
  /** Stroke / line color (default "#4B5563") */
  color?: string;
  /** Stroke thickness in px (default 2.5) */
  strokeWidth?: number;
}

// BoardMetadata is now defined in services/board.ts
