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
  rotation: number;
  zIndex: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Connector {
  id: string;
  fromId: string;
  toId: string;
  style: "arrow" | "line";
  points?: number[];
}

export interface BoardMetadata {
  title: string;
  createdAt: number;
  ownerId: string;
}
