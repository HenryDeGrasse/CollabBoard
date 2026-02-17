import { getAdminDb } from "../firebaseAdmin";
import { resolvePlacement, clampValue, SIZE_MIN, SIZE_MAX, COORD_MIN, COORD_MAX, TEXT_MAX_LENGTH } from "../placement";
import type { CompactObject, Viewport } from "../boardState";
import { ServerValue } from "firebase-admin/database";

interface ToolResult {
  success: boolean;
  objectId?: string;
  error?: string;
  data?: any;
}

// Shared context for placement resolution
export interface ToolContext {
  boardId: string;
  uid: string;
  viewport: Viewport;
  existingObjects: CompactObject[];
}

function sanitizeText(text: string | undefined): string {
  if (!text) return "";
  return String(text).slice(0, TEXT_MAX_LENGTH);
}

function sanitizeCoord(val: number | undefined): number {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return clampValue(val, COORD_MIN, COORD_MAX);
}

function sanitizeSize(val: number | undefined, min = SIZE_MIN, max = SIZE_MAX): number {
  if (val === undefined || val === null || isNaN(val)) return min;
  return clampValue(val, min, max);
}

function sanitizeColor(color: string | undefined): string {
  if (!color || typeof color !== "string") return "#FBBF24";
  // Basic hex validation
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) return color;
  return "#FBBF24";
}

// ─── Create Tools ─────────────────────────────────────────────

export async function createStickyNote(
  ctx: ToolContext,
  text: string,
  x: number,
  y: number,
  color: string
): Promise<ToolResult> {
  try {
    const w = 150;
    const h = 150;
    const pos = resolvePlacement(sanitizeCoord(x), sanitizeCoord(y), w, h, ctx.viewport, ctx.existingObjects);

    const db = getAdminDb();
    const ref = db.ref(`boards/${ctx.boardId}/objects`).push();
    const id = ref.key!;
    const now = Date.now();

    const obj = {
      id,
      type: "sticky",
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      color: sanitizeColor(color),
      text: sanitizeText(text),
      rotation: 0,
      zIndex: now,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(obj);

    // Track for future placement in same command
    ctx.existingObjects.push({ ...obj, parentFrameId: null });

    return { success: true, objectId: id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createShape(
  ctx: ToolContext,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
): Promise<ToolResult> {
  try {
    const validTypes = ["rectangle", "circle", "line"];
    const shapeType = validTypes.includes(type) ? type : "rectangle";
    const w = sanitizeSize(width);
    const h = sanitizeSize(height);
    const pos = resolvePlacement(sanitizeCoord(x), sanitizeCoord(y), w, h, ctx.viewport, ctx.existingObjects);

    const db = getAdminDb();
    const ref = db.ref(`boards/${ctx.boardId}/objects`).push();
    const id = ref.key!;
    const now = Date.now();

    const obj = {
      id,
      type: shapeType,
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      color: sanitizeColor(color),
      rotation: 0,
      zIndex: now,
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(obj);
    ctx.existingObjects.push({ ...obj, parentFrameId: null });

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
  width: number,
  height: number
): Promise<ToolResult> {
  try {
    const w = sanitizeSize(width, 200, SIZE_MAX);
    const h = sanitizeSize(height, 150, SIZE_MAX);
    const pos = resolvePlacement(sanitizeCoord(x), sanitizeCoord(y), w, h, ctx.viewport, ctx.existingObjects);

    const db = getAdminDb();
    const ref = db.ref(`boards/${ctx.boardId}/objects`).push();
    const id = ref.key!;
    const now = Date.now();

    const obj = {
      id,
      type: "frame",
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      color: "#F3F4F6",
      text: sanitizeText(title),
      rotation: 0,
      zIndex: now - 1000, // Frames render below other objects
      createdBy: ctx.uid,
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(obj);
    ctx.existingObjects.push({ ...obj, parentFrameId: null });

    return { success: true, objectId: id };
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
    if (!fromId || !toId) return { success: false, error: "Missing fromId or toId" };
    const validStyles = ["arrow", "line"];
    const connStyle = validStyles.includes(style) ? style : "arrow";

    const db = getAdminDb();
    const ref = db.ref(`boards/${ctx.boardId}/connectors`).push();
    const id = ref.key!;

    await ref.set({ id, fromId, toId, style: connStyle });

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
    const db = getAdminDb();
    await db.ref(`boards/${ctx.boardId}/objects/${objectId}`).update({
      x: sanitizeCoord(x),
      y: sanitizeCoord(y),
      updatedAt: ServerValue.TIMESTAMP,
    });
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
    const db = getAdminDb();
    await db.ref(`boards/${ctx.boardId}/objects/${objectId}`).update({
      width: sanitizeSize(width),
      height: sanitizeSize(height),
      updatedAt: ServerValue.TIMESTAMP,
    });
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
    const db = getAdminDb();
    await db.ref(`boards/${ctx.boardId}/objects/${objectId}`).update({
      text: sanitizeText(newText),
      updatedAt: ServerValue.TIMESTAMP,
    });
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
    const db = getAdminDb();
    await db.ref(`boards/${ctx.boardId}/objects/${objectId}`).update({
      color: sanitizeColor(color),
      updatedAt: ServerValue.TIMESTAMP,
    });
    return { success: true, objectId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
