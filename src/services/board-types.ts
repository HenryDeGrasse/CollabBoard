import type { BoardObject, Connector } from "../types/board";

// ─── Type Mappings (DB snake_case ↔ App camelCase) ────────────

export function dbToObject(row: any): BoardObject {
  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    color: row.color,
    text: row.text || "",
    textSize: row.text_size ?? null,
    textColor: row.text_color ?? null,
    textVerticalAlign: row.text_vertical_align ?? null,
    rotation: row.rotation,
    zIndex: row.z_index,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    parentFrameId: row.parent_frame_id || null,
    points: row.points || undefined,
    strokeWidth: row.stroke_width || undefined,
  };
}

export function objectToDb(obj: Partial<BoardObject> & { boardId?: string }) {
  const row: Record<string, any> = {};
  if (obj.boardId !== undefined) row.board_id = obj.boardId;
  if (obj.type !== undefined) row.type = obj.type;
  if (obj.x !== undefined) row.x = obj.x;
  if (obj.y !== undefined) row.y = obj.y;
  if (obj.width !== undefined) row.width = obj.width;
  if (obj.height !== undefined) row.height = obj.height;
  if (obj.color !== undefined) row.color = obj.color;
  if (obj.text !== undefined) row.text = obj.text;
  if (obj.textSize !== undefined) row.text_size = obj.textSize;
  if (obj.textColor !== undefined) row.text_color = obj.textColor;
  if (obj.textVerticalAlign !== undefined) row.text_vertical_align = obj.textVerticalAlign;
  if (obj.rotation !== undefined) row.rotation = obj.rotation;
  if (obj.zIndex !== undefined) row.z_index = obj.zIndex;
  if (obj.createdBy !== undefined) row.created_by = obj.createdBy;
  if (obj.parentFrameId !== undefined) row.parent_frame_id = obj.parentFrameId;
  if (obj.points !== undefined) row.points = obj.points;
  if (obj.strokeWidth !== undefined) row.stroke_width = obj.strokeWidth;
  return row;
}

export function dbToConnector(row: any): Connector {
  return {
    id: row.id,
    fromId: row.from_id ?? "",
    toId: row.to_id ?? "",
    style: row.style,
    fromPoint: row.from_point ?? undefined,
    toPoint: row.to_point ?? undefined,
    color: row.color ?? undefined,
    strokeWidth: row.stroke_width ?? undefined,
  };
}

export interface BoardMetadata {
  id: string;
  title: string;
  ownerId: string;
  visibility: "public" | "private";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface BoardMember {
  userId: string;
  role: "owner" | "editor";
  displayName: string;
}

export interface BoardAccessRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  message: string;
  createdAt: string;
}

export type JoinResult =
  | { status: "member"; role: "owner" | "editor" }
  | { status: "joined" }
  | { status: "private" }
  | { status: "not_found" };
