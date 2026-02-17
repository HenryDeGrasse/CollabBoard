import { getAdminDb } from "./firebaseAdmin";

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
  const db = getAdminDb();
  const snap = await db.ref(`boards/${boardId}/objects`).once("value");
  const raw = snap.val();
  if (!raw) return [];

  const allObjects: CompactObject[] = Object.values(raw).map((obj: any) => ({
    id: obj.id,
    type: obj.type,
    x: obj.x ?? 0,
    y: obj.y ?? 0,
    width: obj.width ?? 0,
    height: obj.height ?? 0,
    color: obj.color ?? "",
    text: obj.text,
    rotation: obj.rotation ?? 0,
    zIndex: obj.zIndex ?? 0,
    parentFrameId: obj.parentFrameId ?? null,
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
 * Load connectors for the board (for AI context when needed).
 */
export async function getConnectorsForAI(
  boardId: string
): Promise<Array<{ id: string; fromId: string; toId: string; style: string }>> {
  const db = getAdminDb();
  const snap = await db.ref(`boards/${boardId}/connectors`).once("value");
  const raw = snap.val();
  if (!raw) return [];

  return Object.values(raw).map((c: any) => ({
    id: c.id,
    fromId: c.fromId,
    toId: c.toId,
    style: c.style,
  }));
}
