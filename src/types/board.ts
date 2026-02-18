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
  fromId: string;
  toId: string;
  style: "arrow" | "line";
  points?: number[];
}

// BoardMetadata is now defined in services/board.ts
