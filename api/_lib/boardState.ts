import { getSupabaseAdmin } from "./supabaseAdmin.js";

export interface Viewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  scale: number;
}

export interface CompactObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  rotation: number;
  zIndex: number;
  parentFrameId?: string | null;
}

/**
 * Load board state scoped to viewport + selected objects + recent.
 * Returns a compact list suitable for the AI system prompt.
 */
export async function getBoardStateForAI(
  boardId: string,
  viewport: Viewport,
  selectedIds: string[]
): Promise<CompactObject[]> {
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from("objects")
    .select(
      "id, type, x, y, width, height, color, text, rotation, z_index, parent_frame_id"
    )
    .eq("board_id", boardId)
    .order("z_index", { ascending: false })
    .limit(300);

  if (error || !rows) return [];

  const allObjects: CompactObject[] = rows.map((r: any) => ({
    id: r.id,
    type: r.type,
    x: r.x ?? 0,
    y: r.y ?? 0,
    width: r.width ?? 0,
    height: r.height ?? 0,
    color: r.color ?? "",
    text: r.text ?? "",
    rotation: r.rotation ?? 0,
    zIndex: r.z_index ?? 0,
    parentFrameId: r.parent_frame_id ?? null,
  }));

  // Expand viewport by 400px margin
  const margin = 400;
  const vMinX = viewport.minX - margin;
  const vMinY = viewport.minY - margin;
  const vMaxX = viewport.maxX + margin;
  const vMaxY = viewport.maxY + margin;

  const selectedSet = new Set(selectedIds);
  const included = new Set<string>();
  const result: CompactObject[] = [];

  // 1. Always include selected objects
  for (const obj of allObjects) {
    if (selectedSet.has(obj.id)) {
      result.push(obj);
      included.add(obj.id);
    }
  }

  // 2. Include objects intersecting expanded viewport
  for (const obj of allObjects) {
    if (included.has(obj.id)) continue;
    const objRight = obj.x + obj.width;
    const objBottom = obj.y + obj.height;
    if (obj.x < vMaxX && objRight > vMinX && obj.y < vMaxY && objBottom > vMinY) {
      result.push(obj);
      included.add(obj.id);
    }
  }

  // 3. Include recently modified (top 50 by zIndex as proxy for recency)
  const remaining = allObjects
    .filter((o) => !included.has(o.id))
    .sort((a, b) => b.zIndex - a.zIndex)
    .slice(0, 50);

  for (const obj of remaining) {
    result.push(obj);
    included.add(obj.id);
  }

  // Cap at 200 objects total
  return result.slice(0, 200);
}

/**
 * Load connectors for the board.
 */
export async function getConnectorsForAI(
  boardId: string
): Promise<Array<{ id: string; fromId: string; toId: string; style: string }>> {
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from("connectors")
    .select("id, from_id, to_id, style")
    .eq("board_id", boardId);

  if (error || !rows) return [];

  return rows.map((r: any) => ({
    id: r.id,
    fromId: r.from_id,
    toId: r.to_id,
    style: r.style,
  }));
}
