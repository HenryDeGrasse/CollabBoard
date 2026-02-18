import { getSupabaseAdmin } from "../supabaseAdmin.js";
import {
  resolvePlacement,
  clampValue,
  SIZE_MIN,
  SIZE_MAX,
  COORD_MIN,
  COORD_MAX,
  TEXT_MAX_LENGTH,
} from "../placement.js";
import {
  placeObjectInFrame,
  calculateFrameSize,
  arrangeChildrenInGrid,
  computeFrameExpansionForChildren,
} from "../framePlacement.js";
import type { CompactObject, Viewport } from "../boardState.js";

interface ToolResult {
  success: boolean;
  objectId?: string;
  error?: string;
  data?: any;
}

// Batch grid state for sequential free-placement (no frame, no explicit x/y).
// Produces a clean grid instead of spiral-scatter when the AI creates multiple
// objects in one session.
interface BatchGrid {
  anchorX: number;
  anchorY: number;
  nextIndex: number;
  maxCols: number;
  cellWidth: number;
  cellHeight: number;
}

// Shared context for placement resolution
export interface ToolContext {
  boardId: string;
  uid: string;
  viewport: Viewport;
  existingObjects: CompactObject[];
  /** Auto-populated on the first free-placement without explicit x/y. */
  batchGrid?: BatchGrid;
  /** Monotonic counter for generating stable client_ids within a job. */
  clientIdCounter?: number;
}

/** Generate a deterministic client_id for idempotent creates within a job. */
function nextClientId(ctx: ToolContext, commandId?: string): string | null {
  if (!commandId) return null;
  ctx.clientIdCounter = (ctx.clientIdCounter ?? 0) + 1;
  // Deterministic: same commandId + counter = same UUID seed
  // Use a simple scheme: hash of commandId + counter
  return `${commandId.slice(0, 8)}-0000-4000-8000-${String(ctx.clientIdCounter).padStart(12, "0")}`;
}

// ─── Sanitizers ───────────────────────────────────────────────

function sanitizeText(text: string | undefined): string {
  if (!text) return "";
  return String(text).slice(0, TEXT_MAX_LENGTH);
}

function sanitizeCoord(val: number | undefined): number {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return clampValue(val, COORD_MIN, COORD_MAX);
}

function sanitizeSize(
  val: number | undefined,
  min = SIZE_MIN,
  max = SIZE_MAX
): number {
  if (val === undefined || val === null || isNaN(val)) return min;
  return clampValue(val, min, max);
}

const PALETTE = [
  "#FBBF24", "#F472B6", "#3B82F6", "#22C55E",
  "#F97316", "#A855F7", "#EF4444", "#9CA3AF",
];

function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function resolveColor(color: string | undefined): string {
  if (color === "random") return randomColor();
  if (!color || typeof color !== "string") return "#FBBF24";
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) return color;
  return "#FBBF24";
}

/** @deprecated use resolveColor */
function sanitizeColor(color: string | undefined): string {
  return resolveColor(color);
}

// ─── Helpers ──────────────────────────────────────────────────

function getFrameChildren(
  frameId: string,
  objects: CompactObject[]
): CompactObject[] {
  return objects.filter((o) => o.parentFrameId === frameId);
}

function findObject(
  objectId: string,
  objects: CompactObject[]
): CompactObject | undefined {
  return objects.find((o) => o.id === objectId);
}

/**
 * Place an object using the batch grid — produces clean rows/columns
 * instead of spiral scatter when the AI creates multiple free objects.
 */
function placeBatchGrid(
  ctx: ToolContext,
  w: number,
  h: number
): { x: number; y: number } {
  const BATCH_GAP = 20;
  const MAX_COLS = 4;

  if (!ctx.batchGrid) {
    // First free-placed object: find a clear spot near viewport center
    const anchor = resolvePlacement(
      ctx.viewport.centerX - w / 2,
      ctx.viewport.centerY - h / 2,
      w,
      h,
      ctx.viewport,
      ctx.existingObjects
    );
    ctx.batchGrid = {
      anchorX: anchor.x,
      anchorY: anchor.y,
      nextIndex: 0,
      maxCols: MAX_COLS,
      cellWidth: w + BATCH_GAP,
      cellHeight: h + BATCH_GAP,
    };
  }

  const { anchorX, anchorY, nextIndex, maxCols, cellWidth, cellHeight } =
    ctx.batchGrid;

  const col = nextIndex % maxCols;
  const row = Math.floor(nextIndex / maxCols);
  const posX = anchorX + col * cellWidth;
  const posY = anchorY + row * cellHeight;

  ctx.batchGrid.nextIndex++;

  return { x: posX, y: posY };
}

/**
 * Auto-expand a frame in the DB if the layout engine says it needs to grow.
 */
async function autoExpandFrame(
  boardId: string,
  frameId: string,
  expansion: { width: number; height: number },
  objects: CompactObject[]
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("objects")
    .update({
      width: expansion.width,
      height: expansion.height,
      updated_at: new Date().toISOString(),
    })
    .eq("id", frameId)
    .eq("board_id", boardId);

  // Update local cache
  const frame = findObject(frameId, objects);
  if (frame) {
    frame.width = expansion.width;
    frame.height = expansion.height;
  }
}

// ─── Create Tools ─────────────────────────────────────────────

export async function createStickyNote(
  ctx: ToolContext,
  text: string,
  x: number | undefined,
  y: number | undefined,
  color: string,
  parentFrameId?: string
): Promise<ToolResult> {
  try {
    const w = 150;
    const h = 150;
    let posX: number;
    let posY: number;
    let resolvedParentFrameId: string | null = null;

    if (parentFrameId) {
      // Place inside the frame using grid layout
      const frame = findObject(parentFrameId, ctx.existingObjects);
      if (!frame || frame.type !== "frame") {
        return {
          success: false,
          error: `Frame not found: ${parentFrameId}`,
        };
      }

      const children = getFrameChildren(parentFrameId, ctx.existingObjects);
      const layout = placeObjectInFrame(frame, children, w, h);

      posX = layout.objectX;
      posY = layout.objectY;
      resolvedParentFrameId = parentFrameId;

      // Auto-expand frame if needed
      if (layout.frameExpansion) {
        await autoExpandFrame(
          ctx.boardId,
          parentFrameId,
          layout.frameExpansion,
          ctx.existingObjects
        );
      }
    } else if (x !== undefined && y !== undefined) {
      // Explicit position — use overlap avoidance from that point
      const pos = resolvePlacement(
        sanitizeCoord(x),
        sanitizeCoord(y),
        w,
        h,
        ctx.viewport,
        ctx.existingObjects
      );
      posX = pos.x;
      posY = pos.y;
    } else {
      // No position specified — use batch grid for clean sequential layout
      const placed = placeBatchGrid(ctx, w, h);
      posX = placed.x;
      posY = placed.y;
    }

    const supabase = getSupabaseAdmin();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const zIndex = Date.now();

    const obj = {
      id,
      board_id: ctx.boardId,
      type: "sticky" as const,
      x: posX,
      y: posY,
      width: w,
      height: h,
      color: sanitizeColor(color),
      text: sanitizeText(text),
      rotation: 0,
      z_index: zIndex,
      parent_frame_id: resolvedParentFrameId,
      created_by: ctx.uid,
      created_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("objects").insert(obj);
    if (error) return { success: false, error: error.message };

    // Track for future placement
    ctx.existingObjects.push({
      id,
      type: "sticky",
      x: posX,
      y: posY,
      width: w,
      height: h,
      color: obj.color,
      text: obj.text,
      rotation: 0,
      zIndex,
      parentFrameId: resolvedParentFrameId,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createShape(
  ctx: ToolContext,
  type: string,
  x: number | undefined,
  y: number | undefined,
  width: number | undefined,
  height: number | undefined,
  color: string,
  parentFrameId?: string,
  x2?: number,
  y2?: number
): Promise<ToolResult> {
  try {
    const validTypes = ["rectangle", "circle", "line"];
    const shapeType = validTypes.includes(type) ? type : "rectangle";

    // If x2/y2 given, compute x, y, width, height from two corners
    if (x !== undefined && y !== undefined && x2 !== undefined && y2 !== undefined) {
      const minX = Math.min(x, x2);
      const minY = Math.min(y, y2);
      width = Math.abs(x2 - x);
      height = Math.abs(y2 - y);
      x = minX;
      y = minY;
    }

    const w = sanitizeSize(width ?? 150);
    const h = sanitizeSize(height ?? 100);

    let posX: number;
    let posY: number;
    let resolvedParentFrameId: string | null = null;

    if (parentFrameId) {
      const frame = findObject(parentFrameId, ctx.existingObjects);
      if (!frame || frame.type !== "frame") {
        return {
          success: false,
          error: `Frame not found: ${parentFrameId}`,
        };
      }

      const children = getFrameChildren(parentFrameId, ctx.existingObjects);
      const layout = placeObjectInFrame(frame, children, w, h);

      posX = layout.objectX;
      posY = layout.objectY;
      resolvedParentFrameId = parentFrameId;

      if (layout.frameExpansion) {
        await autoExpandFrame(
          ctx.boardId,
          parentFrameId,
          layout.frameExpansion,
          ctx.existingObjects
        );
      }
    } else if (x !== undefined && y !== undefined) {
      const pos = resolvePlacement(
        sanitizeCoord(x),
        sanitizeCoord(y),
        w,
        h,
        ctx.viewport,
        ctx.existingObjects
      );
      posX = pos.x;
      posY = pos.y;
    } else {
      // No position specified — use batch grid for clean sequential layout
      const placed = placeBatchGrid(ctx, w, h);
      posX = placed.x;
      posY = placed.y;
    }

    const supabase = getSupabaseAdmin();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const zIndex = Date.now();

    const obj = {
      id,
      board_id: ctx.boardId,
      type: shapeType,
      x: posX,
      y: posY,
      width: w,
      height: h,
      color: sanitizeColor(color),
      rotation: 0,
      z_index: zIndex,
      parent_frame_id: resolvedParentFrameId,
      created_by: ctx.uid,
      created_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("objects").insert(obj);
    if (error) return { success: false, error: error.message };

    ctx.existingObjects.push({
      id,
      type: shapeType,
      x: posX,
      y: posY,
      width: w,
      height: h,
      color: obj.color,
      rotation: 0,
      zIndex,
      parentFrameId: resolvedParentFrameId,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createFrame(
  ctx: ToolContext,
  title: string,
  x: number,
  y: number,
  width: number | undefined,
  height: number | undefined,
  expectedChildCount?: number
): Promise<ToolResult> {
  try {
    let w: number;
    let h: number;

    if (expectedChildCount && expectedChildCount > 0) {
      // Auto-size based on expected content
      const autoSize = calculateFrameSize(expectedChildCount);
      w = Math.max(sanitizeSize(width ?? autoSize.width, 200, SIZE_MAX), autoSize.width);
      h = Math.max(sanitizeSize(height ?? autoSize.height, 150, SIZE_MAX), autoSize.height);
    } else {
      w = sanitizeSize(width ?? 400, 200, SIZE_MAX);
      h = sanitizeSize(height ?? 300, 150, SIZE_MAX);
    }

    const pos = resolvePlacement(
      sanitizeCoord(x),
      sanitizeCoord(y),
      w,
      h,
      ctx.viewport,
      ctx.existingObjects
    );

    const supabase = getSupabaseAdmin();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const zIndex = Date.now() - 1000; // Frames render below other objects

    const obj = {
      id,
      board_id: ctx.boardId,
      type: "frame" as const,
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      color: "#F3F4F6",
      text: sanitizeText(title),
      rotation: 0,
      z_index: zIndex,
      parent_frame_id: null,
      created_by: ctx.uid,
      created_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("objects").insert(obj);
    if (error) return { success: false, error: error.message };

    ctx.existingObjects.push({
      id,
      type: "frame",
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      color: "#F3F4F6",
      text: obj.text,
      rotation: 0,
      zIndex,
      parentFrameId: null,
    });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function addObjectToFrame(
  ctx: ToolContext,
  objectId: string,
  frameId: string
): Promise<ToolResult> {
  try {
    if (!objectId || !frameId) {
      return { success: false, error: "Missing objectId or frameId" };
    }

    const frame = findObject(frameId, ctx.existingObjects);
    if (!frame || frame.type !== "frame") {
      return { success: false, error: `Frame not found: ${frameId}` };
    }

    const obj = findObject(objectId, ctx.existingObjects);
    if (!obj) {
      return { success: false, error: `Object not found: ${objectId}` };
    }

    const children = getFrameChildren(frameId, ctx.existingObjects);
    const layout = placeObjectInFrame(frame, children, obj.width, obj.height);

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("objects")
      .update({
        x: layout.objectX,
        y: layout.objectY,
        parent_frame_id: frameId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId)
      .eq("board_id", ctx.boardId);

    if (error) return { success: false, error: error.message };

    // Auto-expand frame if needed
    if (layout.frameExpansion) {
      await autoExpandFrame(
        ctx.boardId,
        frameId,
        layout.frameExpansion,
        ctx.existingObjects
      );
    }

    // Update local cache
    obj.x = layout.objectX;
    obj.y = layout.objectY;
    obj.parentFrameId = frameId;

    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function removeObjectFromFrame(
  ctx: ToolContext,
  objectId: string
): Promise<ToolResult> {
  try {
    if (!objectId) return { success: false, error: "Missing objectId" };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("objects")
      .update({
        parent_frame_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId)
      .eq("board_id", ctx.boardId);

    if (error) return { success: false, error: error.message };

    // Update local cache
    const obj = findObject(objectId, ctx.existingObjects);
    if (obj) obj.parentFrameId = null;

    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createConnector(
  ctx: ToolContext,
  fromId: string,
  toId: string,
  style: string
): Promise<ToolResult> {
  try {
    if (!fromId || !toId)
      return { success: false, error: "Missing fromId or toId" };
    const validStyles = ["arrow", "line"];
    const connStyle = validStyles.includes(style) ? style : "arrow";

    const supabase = getSupabaseAdmin();
    const id = crypto.randomUUID();

    const { error } = await supabase.from("connectors").insert({
      id,
      board_id: ctx.boardId,
      from_id: fromId,
      to_id: toId,
      style: connStyle,
    });

    if (error) return { success: false, error: error.message };

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Mutation Tools ───────────────────────────────────────────

export async function moveObject(
  ctx: ToolContext,
  objectId: string,
  x: number,
  y: number
): Promise<ToolResult> {
  try {
    if (!objectId) return { success: false, error: "Missing objectId" };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("objects")
      .update({
        x: sanitizeCoord(x),
        y: sanitizeCoord(y),
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId)
      .eq("board_id", ctx.boardId);

    if (error) return { success: false, error: error.message };

    // Update local cache
    const obj = findObject(objectId, ctx.existingObjects);
    if (obj) {
      obj.x = sanitizeCoord(x);
      obj.y = sanitizeCoord(y);
    }

    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function resizeObject(
  ctx: ToolContext,
  objectId: string,
  width: number,
  height: number
): Promise<ToolResult> {
  try {
    if (!objectId) return { success: false, error: "Missing objectId" };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("objects")
      .update({
        width: sanitizeSize(width),
        height: sanitizeSize(height),
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId)
      .eq("board_id", ctx.boardId);

    if (error) return { success: false, error: error.message };

    // Update local cache
    const obj = findObject(objectId, ctx.existingObjects);
    if (obj) {
      obj.width = sanitizeSize(width);
      obj.height = sanitizeSize(height);
    }

    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function updateText(
  ctx: ToolContext,
  objectId: string,
  newText: string
): Promise<ToolResult> {
  try {
    if (!objectId) return { success: false, error: "Missing objectId" };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("objects")
      .update({
        text: sanitizeText(newText),
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId)
      .eq("board_id", ctx.boardId);

    if (error) return { success: false, error: error.message };

    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function changeColor(
  ctx: ToolContext,
  objectId: string,
  color: string
): Promise<ToolResult> {
  try {
    if (!objectId) return { success: false, error: "Missing objectId" };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("objects")
      .update({
        color: sanitizeColor(color),
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectId)
      .eq("board_id", ctx.boardId);

    if (error) return { success: false, error: error.message };

    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Bulk Tools ───────────────────────────────────────────────

/**
 * Unified bulk delete.  Supports:
 *  - mode "all"        → wipe the entire board
 *  - mode "by_ids"     → delete specific objects by ID
 *  - mode "by_type"    → delete all objects of a given type (sticky, shape, frame, connector)
 */
export async function bulkDelete(
  ctx: ToolContext,
  mode: "all" | "by_ids" | "by_type",
  objectIds?: string[],
  objectType?: string
): Promise<ToolResult> {
  try {
    const supabase = getSupabaseAdmin();

    if (mode === "all") {
      // Wipe connectors first (FK → objects)
      try {
        await supabase.from("connectors").delete().eq("board_id", ctx.boardId);
      } catch { /* table may not exist */ }

      const { error } = await supabase
        .from("objects")
        .delete()
        .eq("board_id", ctx.boardId);
      if (error) return { success: false, error: error.message };

      const deletedCount = ctx.existingObjects.length;
      ctx.existingObjects.length = 0;
      ctx.batchGrid = undefined;
      return {
        success: true,
        data: { deletedCount, message: `Deleted all ${deletedCount} objects` },
      };
    }

    if (mode === "by_type") {
      const validTypes = ["sticky", "shape", "frame", "connector", "rectangle", "circle", "line"];
      if (!objectType || !validTypes.includes(objectType)) {
        return { success: false, error: `Invalid type. Use one of: ${validTypes.join(", ")}` };
      }
      // Normalize shape sub-types
      const matchTypes = objectType === "shape"
        ? ["rectangle", "circle", "line"]
        : [objectType];

      const idsToDelete = ctx.existingObjects
        .filter((o) => matchTypes.includes(o.type))
        .map((o) => o.id);

      if (idsToDelete.length === 0) {
        return { success: true, data: { deletedCount: 0, message: `No ${objectType} objects found` } };
      }
      // Recurse with by_ids
      return bulkDelete(ctx, "by_ids", idsToDelete);
    }

    // mode === "by_ids"
    if (!objectIds || objectIds.length === 0) {
      return { success: false, error: "No object IDs provided" };
    }

    const deletedIds: string[] = [];
    for (let i = 0; i < objectIds.length; i += 50) {
      const batch = objectIds.slice(i, i + 50);
      const { error } = await supabase
        .from("objects")
        .delete()
        .eq("board_id", ctx.boardId)
        .in("id", batch);
      if (!error) deletedIds.push(...batch);
    }

    // Update local cache in-place
    for (let i = ctx.existingObjects.length - 1; i >= 0; i--) {
      if (deletedIds.includes(ctx.existingObjects[i].id)) {
        ctx.existingObjects.splice(i, 1);
      }
    }

    return {
      success: true,
      data: { deletedIds, count: deletedIds.length },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Unified bulk create.  Creates many objects of any type in one tool call.
 *
 * Supported types: "sticky", "rectangle", "circle", "frame"
 * Color can be a hex code, "random" for a random palette color, or omitted
 * for the default.  Each item can target a frame via parentFrameId (auto-grid)
 * or be free-placed (auto-grid when x/y omitted).
 */
export async function bulkCreate(
  ctx: ToolContext,
  items: Array<{
    type: "sticky" | "rectangle" | "circle" | "frame";
    text?: string;
    color?: string;          // hex code | "random"
    width?: number;
    height?: number;
    x2?: number;
    y2?: number;
    parentFrameId?: string;
    x?: number;
    y?: number;
    expectedChildCount?: number; // frames only
  }>
): Promise<ToolResult> {
  try {
    if (!items || items.length === 0) {
      return { success: false, error: "No items provided" };
    }

    const supabase = getSupabaseAdmin();
    const createdIds: string[] = [];

    for (const item of items) {
      const isFrame = item.type === "frame";
      const isSticky = item.type === "sticky";
      const shapeTypes = ["rectangle", "circle"];
      const isShape = shapeTypes.includes(item.type);

      if (!isFrame && !isSticky && !isShape) continue;

      // ── Two-corner resolution ──
      if (item.x !== undefined && item.y !== undefined && item.x2 !== undefined && item.y2 !== undefined) {
        const minX = Math.min(item.x, item.x2);
        const minY = Math.min(item.y, item.y2);
        item.width = Math.abs(item.x2 - item.x);
        item.height = Math.abs(item.y2 - item.y);
        item.x = minX;
        item.y = minY;
      }

      // ── Size ──
      let w: number;
      let h: number;
      if (isSticky) {
        w = 150;
        h = 150;
      } else if (isFrame) {
        if (item.expectedChildCount && item.expectedChildCount > 0) {
          const autoSize = calculateFrameSize(item.expectedChildCount);
          w = Math.max(sanitizeSize(item.width ?? autoSize.width, 200, SIZE_MAX), autoSize.width);
          h = Math.max(sanitizeSize(item.height ?? autoSize.height, 150, SIZE_MAX), autoSize.height);
        } else {
          w = sanitizeSize(item.width ?? 400, 200, SIZE_MAX);
          h = sanitizeSize(item.height ?? 300, 150, SIZE_MAX);
        }
      } else {
        w = sanitizeSize(item.width ?? 100, SIZE_MIN, SIZE_MAX);
        h = sanitizeSize(item.height ?? 100, SIZE_MIN, SIZE_MAX);
      }

      // ── Position ──
      let posX: number;
      let posY: number;
      let resolvedParentFrameId: string | null = null;

      if (!isFrame && item.parentFrameId) {
        const frame = findObject(item.parentFrameId, ctx.existingObjects);
        if (!frame || frame.type !== "frame") continue;

        const children = getFrameChildren(item.parentFrameId, ctx.existingObjects);
        const layout = placeObjectInFrame(frame, children, w, h);
        posX = layout.objectX;
        posY = layout.objectY;
        resolvedParentFrameId = item.parentFrameId;

        if (layout.frameExpansion) {
          await autoExpandFrame(
            ctx.boardId,
            item.parentFrameId,
            layout.frameExpansion,
            ctx.existingObjects
          );
        }
      } else if (item.x !== undefined && item.y !== undefined) {
        const pos = resolvePlacement(
          sanitizeCoord(item.x),
          sanitizeCoord(item.y),
          w, h,
          ctx.viewport,
          ctx.existingObjects
        );
        posX = pos.x;
        posY = pos.y;
      } else {
        const placed = placeBatchGrid(ctx, w, h);
        posX = placed.x;
        posY = placed.y;
      }

      // ── Color ──
      const color = isFrame ? "#F3F4F6" : resolveColor(item.color);

      // ── DB type ──
      const dbType: string = isSticky ? "sticky" : isFrame ? "frame" : item.type;

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const zIndex = isFrame
        ? Date.now() - 1000 + createdIds.length  // frames below
        : Date.now() + createdIds.length;

      const obj = {
        id,
        board_id: ctx.boardId,
        type: dbType,
        x: posX,
        y: posY,
        width: w,
        height: h,
        color,
        text: sanitizeText(item.text ?? ""),
        rotation: 0,
        z_index: zIndex,
        parent_frame_id: resolvedParentFrameId,
        created_by: ctx.uid,
        created_at: now,
        updated_at: now,
      };

      const { error } = await supabase.from("objects").insert(obj);
      if (error) continue;

      createdIds.push(id);
      ctx.existingObjects.push({
        id,
        type: dbType,
        x: posX,
        y: posY,
        width: w,
        height: h,
        color,
        text: obj.text,
        rotation: 0,
        zIndex,
        parentFrameId: resolvedParentFrameId,
      });
    }

    return {
      success: true,
      data: { createdIds, count: createdIds.length },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Layout Tools ─────────────────────────────────────────────

/**
 * Arrange a set of objects into a grid, row, or column.
 * Positions are computed deterministically — no LLM math needed.
 * Objects are centered around the current bounding-box center of the group.
 */
export async function arrangeObjects(
  ctx: ToolContext,
  objectIds: string[],
  layout: "grid" | "row" | "column",
  spacing?: number
): Promise<ToolResult> {
  try {
    if (!objectIds || objectIds.length === 0) {
      return { success: false, error: "No object IDs provided" };
    }

    const gap = typeof spacing === "number" ? Math.max(0, Math.min(spacing, 200)) : 20;

    const objects = objectIds
      .map((id) => findObject(id, ctx.existingObjects))
      .filter(Boolean) as CompactObject[];

    if (objects.length === 0) {
      return { success: false, error: "No valid objects found for given IDs" };
    }

    // Compute center of current bounding box
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const obj of objects) {
      minX = Math.min(minX, obj.x);
      minY = Math.min(minY, obj.y);
      maxX = Math.max(maxX, obj.x + obj.width);
      maxY = Math.max(maxY, obj.y + obj.height);
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Compute new positions
    const positions: { id: string; x: number; y: number }[] = [];

    if (layout === "row") {
      const totalWidth =
        objects.reduce((sum, obj) => sum + obj.width, 0) +
        gap * (objects.length - 1);
      let curX = centerX - totalWidth / 2;
      const maxH = Math.max(...objects.map((o) => o.height));
      const rowY = centerY - maxH / 2;

      for (const obj of objects) {
        positions.push({ id: obj.id, x: curX, y: rowY });
        curX += obj.width + gap;
      }
    } else if (layout === "column") {
      const totalHeight =
        objects.reduce((sum, obj) => sum + obj.height, 0) +
        gap * (objects.length - 1);
      let curY = centerY - totalHeight / 2;
      const maxW = Math.max(...objects.map((o) => o.width));
      const colX = centerX - maxW / 2;

      for (const obj of objects) {
        positions.push({ id: obj.id, x: colX, y: curY });
        curY += obj.height + gap;
      }
    } else {
      // Grid — square-ish arrangement
      const cols = Math.ceil(Math.sqrt(objects.length));
      const maxW = Math.max(...objects.map((o) => o.width));
      const maxH = Math.max(...objects.map((o) => o.height));
      const cellW = maxW + gap;
      const cellH = maxH + gap;
      const rows = Math.ceil(objects.length / cols);
      const totalW = cols * cellW - gap;
      const totalH = rows * cellH - gap;
      const startX = centerX - totalW / 2;
      const startY = centerY - totalH / 2;

      objects.forEach((obj, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        positions.push({ id: obj.id, x: startX + c * cellW, y: startY + r * cellH });
      });
    }

    // Write to DB + update cache
    const supabase = getSupabaseAdmin();
    const updatedIds: string[] = [];

    for (const pos of positions) {
      const { error } = await supabase
        .from("objects")
        .update({ x: pos.x, y: pos.y, updated_at: new Date().toISOString() })
        .eq("id", pos.id)
        .eq("board_id", ctx.boardId);

      if (!error) {
        updatedIds.push(pos.id);
        const obj = findObject(pos.id, ctx.existingObjects);
        if (obj) {
          obj.x = pos.x;
          obj.y = pos.y;
        }
      }
    }

    return {
      success: true,
      data: { updatedIds, layout, count: updatedIds.length },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Tidy the children of a frame into a clean grid.
 * Uses the existing `arrangeChildrenInGrid` layout engine.
 */
export async function rearrangeFrame(
  ctx: ToolContext,
  frameId: string
): Promise<ToolResult> {
  try {
    if (!frameId) return { success: false, error: "Missing frameId" };

    const frame = findObject(frameId, ctx.existingObjects);
    if (!frame || frame.type !== "frame") {
      return { success: false, error: `Frame not found: ${frameId}` };
    }

    const children = getFrameChildren(frameId, ctx.existingObjects);
    if (children.length === 0) {
      return {
        success: true,
        data: { updatedIds: [], message: "Frame is empty" },
      };
    }

    // Compute tidy grid positions
    const positions: Record<string, { x: number; y: number }> = arrangeChildrenInGrid(frame, children);

    // Expand frame if needed to fit all children + reserve slot
    const expansion = computeFrameExpansionForChildren(frame, children.length);
    if (expansion) {
      await autoExpandFrame(ctx.boardId, frameId, expansion, ctx.existingObjects);
    }

    // Write child positions to DB + update cache
    const supabase = getSupabaseAdmin();
    const updatedIds: string[] = [];

    for (const [childId, pos] of Object.entries(positions)) {
      const { error } = await supabase
        .from("objects")
        .update({ x: pos.x, y: pos.y, updated_at: new Date().toISOString() })
        .eq("id", childId)
        .eq("board_id", ctx.boardId);

      if (!error) {
        updatedIds.push(childId);
        const obj = findObject(childId, ctx.existingObjects);
        if (obj) {
          obj.x = pos.x;
          obj.y = pos.y;
        }
      }
    }

    return {
      success: true,
      data: { updatedIds, count: updatedIds.length, frameId },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ─── Scoped Query Tool ───────────────────────────────────────

/**
 * Scoped board context retrieval.
 * Replaces the old dump-everything `getBoardState`.
 */
export function getBoardContext(
  ctx: ToolContext,
  scope: "selected" | "viewport" | "frame" | "all" | "ids",
  selectedIds?: string[],
  frameId?: string,
  objectIds?: string[],
  typeFilter?: string
): { objects: any[]; total: number } {
  let results: CompactObject[] = [];
  const typeNorm = typeFilter
    ? typeFilter === "shape"
      ? ["rectangle", "circle", "line"]
      : [typeFilter]
    : null;

  switch (scope) {
    case "selected":
      if (selectedIds && selectedIds.length > 0) {
        const set = new Set(selectedIds);
        results = ctx.existingObjects.filter((o) => set.has(o.id));
      }
      break;

    case "viewport":
      results = ctx.existingObjects.filter((o) => {
        const r = o.x + o.width;
        const b = o.y + o.height;
        return (
          o.x < ctx.viewport.maxX + 200 &&
          r > ctx.viewport.minX - 200 &&
          o.y < ctx.viewport.maxY + 200 &&
          b > ctx.viewport.minY - 200
        );
      });
      break;

    case "frame":
      if (frameId) {
        results = ctx.existingObjects.filter(
          (o) => o.parentFrameId === frameId || o.id === frameId
        );
      }
      break;

    case "ids":
      if (objectIds && objectIds.length > 0) {
        const set = new Set(objectIds);
        results = ctx.existingObjects.filter((o) => set.has(o.id));
      }
      break;

    case "all":
    default:
      results = [...ctx.existingObjects];
      break;
  }

  // Apply type filter
  if (typeNorm) {
    results = results.filter((o) => typeNorm.includes(o.type));
  }

  // Cap at 100 objects per query
  const total = results.length;
  results = results.slice(0, 100);

  return {
    objects: results.map((o) => ({
      id: o.id,
      type: o.type,
      x: Math.round(o.x),
      y: Math.round(o.y),
      w: Math.round(o.width),
      h: Math.round(o.height),
      color: o.color,
      text: o.text?.slice(0, 80),
      parentFrameId: o.parentFrameId || undefined,
    })),
    total,
  };
}
