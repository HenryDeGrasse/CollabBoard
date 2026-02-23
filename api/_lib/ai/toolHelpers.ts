/**
 * Shared helpers used across AI tool executors.
 *
 * Color mapping, type defaults, object annotation, navigation viewport
 * computation, canvas space finding, and batch patching utilities.
 */
import { getSupabaseAdmin } from "../supabaseAdmin.js";

// ─── Color name ↔ hex mapping (matches src/utils/colors.ts) ─────

const COLOR_NAME_TO_HEX: Record<string, string> = {
  yellow:   "#FAD84E",
  pink:     "#F5A8C4",
  blue:     "#7FC8E8",
  green:    "#9DD9A3",
  grey:     "#E5E5E0",
  gray:     "#E5E5E0",
  offwhite: "#F9F9F7",
  red:      "#CC0000",
  black:    "#111111",
  darkgrey: "#404040",
  white:    "#FFFFFF",
  "light gray": "#E5E5E0",
  "light grey": "#E5E5E0",
};

const HEX_TO_COLOR_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(COLOR_NAME_TO_HEX).map(([name, hex]) => [hex.toLowerCase(), name])
);

/** Resolve a user-supplied color string to a hex code. */
export function resolveColor(input: string): string | null {
  const cleanedInput = input.replace(/\s*\(.*?\)\s*$/, '');
  const lower = cleanedInput.trim().toLowerCase();
  if (lower.startsWith("#")) return lower; // already hex
  return COLOR_NAME_TO_HEX[lower] ?? null;
}

/** Return a human-readable label for a hex color. */
export function colorLabel(hex: string): string {
  return HEX_TO_COLOR_NAME[hex.toLowerCase()] ?? hex;
}

// ─── Type Defaults ─────────────────────────────────────────────

export const TYPE_DEFAULTS: Record<string, { width: number; height: number; color: string }> = {
  sticky:    { width: 150, height: 150, color: "#FAD84E" },
  rectangle: { width: 200, height: 150, color: "#111111" },
  circle:    { width: 120, height: 120, color: "#111111" },
  text:      { width: 200, height: 50, color: "#111111" },
  frame:     { width: 800, height: 600, color: "#F9F9F7" },
};

// ─── Navigation Viewport ──────────────────────────────────────

export function computeNavigationViewport(
  objects: Array<{ x: number; y: number; width: number; height: number }>,
  screenSize?: { width: number; height: number }
): { x: number; y: number; scale: number } | null {
  if (objects.length === 0) return null;

  const minX = Math.min(...objects.map((o) => o.x));
  const minY = Math.min(...objects.map((o) => o.y));
  const maxX = Math.max(...objects.map((o) => o.x + o.width));
  const maxY = Math.max(...objects.map((o) => o.y + o.height));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const boxW = Math.max(maxX - minX, 1);
  const boxH = Math.max(maxY - minY, 1);

  const sw = screenSize?.width ?? 1280;
  const sh = screenSize?.height ?? 800;
  const pad = 0.82;
  const scale = Math.min(Math.max(Math.min((sw * pad) / boxW, (sh * pad) / boxH), 0.1), 2.0);

  return {
    x: Math.round(sw / 2 - centerX * scale),
    y: Math.round(sh / 2 - centerY * scale),
    scale: Math.round(scale * 1000) / 1000,
  };
}

// ─── Canvas Space Finding ─────────────────────────────────────

export async function findOpenCanvasSpace(
  boardId: string,
  reqWidth: number,
  reqHeight: number,
  startX = 100,
  startY = 100
): Promise<{ x: number; y: number }> {
  const supabase = getSupabaseAdmin();
  const { data: objects } = await supabase
    .from("objects")
    .select("x, y, width, height")
    .eq("board_id", boardId);

  if (!objects || objects.length === 0) {
    return { x: startX, y: startY };
  }

  let testX = startX;
  let testY = startY;
  const padding = 50;

  // Simple brute-force scan: move right and down until no intersection
  while (true) {
    const intersects = objects.some((o) => {
      return (
        testX < o.x + o.width + padding &&
        testX + reqWidth + padding > o.x &&
        testY < o.y + o.height + padding &&
        testY + reqHeight + padding > o.y
      );
    });

    if (!intersects) {
      return { x: testX, y: testY };
    }

    // Try moving right
    testX += reqWidth + padding;

    // Arbitrary wrap after moving 3000px right
    if (testX > startX + 3000) {
      testX = startX;
      testY += reqHeight + padding;
    }
  }
}

// ─── Object Annotation (for LLM consumption) ──────────────────

export function annotateObjectRow(row: any) {
  const hex: string = row.color ?? "";
  const name = colorLabel(hex);
  const colorAnnotated = name !== hex ? `${hex} (${name})` : hex;

  return {
    id: row.id,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    color: colorAnnotated,
    text: row.text || "",
    rotation: row.rotation,
    zIndex: row.z_index,
    parentFrameId: row.parent_frame_id || null,
  };
}

export function annotateConnectorRow(row: any) {
  return {
    id: row.id,
    fromId: row.from_id ?? "",
    toId: row.to_id ?? "",
    style: row.style,
    color: row.color ?? null,
    strokeWidth: row.stroke_width ?? null,
  };
}

// ─── Batch Object Patching ────────────────────────────────────

export const PATCH_BULK_CHUNK_SIZE = 200;

export function applyPatchToObjectRow(existingRow: any, patch: Record<string, any>, now: string) {
  const row = { ...existingRow };

  if (patch.x !== undefined) row.x = patch.x;
  if (patch.y !== undefined) row.y = patch.y;
  if (patch.width !== undefined) row.width = patch.width;
  if (patch.height !== undefined) row.height = patch.height;
  if (patch.color !== undefined) row.color = resolveColor(patch.color) ?? patch.color;
  if (patch.text !== undefined) row.text = patch.text;
  if (patch.rotation !== undefined) row.rotation = patch.rotation;
  if (patch.parentFrameId !== undefined) {
    row.parent_frame_id = patch.parentFrameId || null;
  }

  row.updated_at = now;
  return row;
}

async function applyObjectPatchesFallback(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boardId: string,
  patches: any[],
  now: string
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }>; succeeded: number }> {
  const results = await Promise.all(
    patches.map(async (patch: any) => {
      const { id, ...updates } = patch;
      if (!id) {
        return { id: "", ok: false, error: "Missing object id" } as { id: string; ok: boolean; error?: string };
      }

      const row: Record<string, any> = {};
      if (updates.x !== undefined) row.x = updates.x;
      if (updates.y !== undefined) row.y = updates.y;
      if (updates.width !== undefined) row.width = updates.width;
      if (updates.height !== undefined) row.height = updates.height;
      if (updates.color !== undefined) row.color = resolveColor(updates.color) ?? updates.color;
      if (updates.text !== undefined) row.text = updates.text;
      if (updates.rotation !== undefined) row.rotation = updates.rotation;
      if (updates.parentFrameId !== undefined) {
        row.parent_frame_id = updates.parentFrameId || null;
      }
      row.updated_at = now;

      const { error } = await supabase
        .from("objects")
        .update(row)
        .eq("id", id)
        .eq("board_id", boardId);

      return { id, ok: !error, error: error?.message } as { id: string; ok: boolean; error?: string };
    })
  );

  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
  };
}

/**
 * Apply object patches with a fast bulk path (single upsert per chunk) and a
 * per-object fallback for exact compatibility when bulk fails.
 */
export async function applyObjectPatches(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boardId: string,
  patches: any[],
  now: string
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }>; succeeded: number }> {
  if (patches.length === 0) return { results: [], succeeded: 0 };

  const patchIds = Array.from(
    new Set(
      patches
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  if (patchIds.length === 0) {
    return applyObjectPatchesFallback(supabase, boardId, patches, now);
  }

  try {
    const existingRows: any[] = [];
    for (let i = 0; i < patchIds.length; i += PATCH_BULK_CHUNK_SIZE) {
      const idChunk = patchIds.slice(i, i + PATCH_BULK_CHUNK_SIZE);
      const { data, error: fetchError } = await supabase
        .from("objects")
        .select("*")
        .eq("board_id", boardId)
        .in("id", idChunk);

      if (fetchError) throw fetchError;
      if (data?.length) existingRows.push(...data);
    }

    const existingById = new Map(existingRows.map((row: any) => [row.id, row]));
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    const upsertRows: any[] = [];

    for (const patch of patches) {
      const id = patch?.id;
      if (!id || typeof id !== "string") {
        results.push({ id: "", ok: false, error: "Missing object id" });
        continue;
      }

      const existing = existingById.get(id);
      if (!existing) {
        results.push({ id, ok: true });
        continue;
      }

      upsertRows.push(applyPatchToObjectRow(existing, patch, now));
      results.push({ id, ok: true });
    }

    for (let i = 0; i < upsertRows.length; i += PATCH_BULK_CHUNK_SIZE) {
      const chunk = upsertRows.slice(i, i + PATCH_BULK_CHUNK_SIZE);
      if (chunk.length === 0) continue;

      const { error } = await supabase
        .from("objects")
        .upsert(chunk, { onConflict: "id" });

      if (error) throw error;
    }

    return {
      results,
      succeeded: results.filter((r) => r.ok).length,
    };
  } catch {
    return applyObjectPatchesFallback(supabase, boardId, patches, now);
  }
}

// ─── Batch Reposition ──────────────────────────────────────────

/**
 * Batch-reposition existing objects. Used by template tools when
 * sourceObjectIds is provided to reorganize instead of create.
 */
export async function repositionObjects(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boardId: string,
  patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }>
): Promise<number> {
  if (patches.length === 0) return 0;
  const now = new Date().toISOString();

  for (let i = 0; i < patches.length; i += PATCH_BULK_CHUNK_SIZE) {
    const chunk = patches.slice(i, i + PATCH_BULK_CHUNK_SIZE);
    const ids = chunk.map((p) => p.id);

    const { data: existing } = await supabase
      .from("objects")
      .select("*")
      .eq("board_id", boardId)
      .in("id", ids);

    if (!existing?.length) continue;

    const byId = new Map(existing.map((r: any) => [r.id, r]));
    const rows: any[] = [];

    for (const patch of chunk) {
      const row = byId.get(patch.id);
      if (!row) continue;
      rows.push({
        ...row,
        x: patch.x,
        y: patch.y,
        parent_frame_id: patch.parentFrameId !== undefined ? (patch.parentFrameId || null) : row.parent_frame_id,
        updated_at: now,
      });
    }

    if (rows.length > 0) {
      await supabase.from("objects").upsert(rows, { onConflict: "id" });
    }
  }

  return patches.length;
}

// ─── Tool Context Type ─────────────────────────────────────────

export interface ToolContext {
  screenSize?: { width: number; height: number };
  selectedIds?: string[];
  viewportCenter?: { x: number; y: number };
}
