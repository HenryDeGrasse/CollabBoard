/**
 * Board Digest — a token-lean representation of the board state.
 *
 * Instead of dumping 200 objects as verbose JSON into the system prompt,
 * this builds a compact, readable digest that gives the LLM enough context
 * to act without drowning in irrelevant detail.
 *
 * The router decides what to include; this module formats it.
 */

import type { CompactObject, Viewport } from "../boardState";
import type { Scope } from "./router";

export interface DigestOptions {
  /** Which objects are selected */
  selectedIds: string[];
  /** Board viewport */
  viewport: Viewport;
  /** Router-determined scope */
  scope: Scope;
  /** Whether to include full object details (vs summary) */
  includeFullObjects: boolean;
  /** Max objects to include in detail (if includeFullObjects) */
  maxDetailObjects?: number;
}

interface FrameInfo {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  childCount: number;
  children: CompactObject[];
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Build a compact board digest string for the system prompt.
 * Token usage is roughly:
 *   - Summary only (empty board): ~30 tokens
 *   - Summary + 5 frames: ~150 tokens
 *   - Summary + 20 detailed objects: ~600 tokens
 *   - Full 200-object dump (old approach): ~8000+ tokens
 */
export function buildBoardDigest(
  allObjects: CompactObject[],
  options: DigestOptions
): string {
  if (allObjects.length === 0) {
    return "The board is currently empty.";
  }

  const { selectedIds, viewport, scope, includeFullObjects } = options;
  const maxDetail = options.maxDetailObjects ?? 50;
  const selectedSet = new Set(selectedIds);

  const lines: string[] = [];

  // ── Always: board summary counts ──
  const counts = countByType(allObjects);
  lines.push(`Board: ${allObjects.length} objects (${formatCounts(counts)})`);

  // ── Always: frame overview ──
  const frames = buildFrameInfos(allObjects);
  if (frames.length > 0) {
    lines.push("");
    lines.push("Frames:");
    for (const f of frames) {
      lines.push(
        `  FRAME ${shortId(f.id)} "${f.title}" pos=(${r(f.x)},${r(f.y)}) size=${r(f.width)}×${r(f.height)} children=${f.childCount}`
      );
    }
  }

  // ── Selected objects (always included in full detail) ──
  const selected = allObjects.filter((o) => selectedSet.has(o.id));
  if (selected.length > 0) {
    lines.push("");
    lines.push(`Selected (${selected.length}):`);
    for (const obj of selected) {
      lines.push("  " + formatObjectLine(obj));
    }
  }

  // ── Scope-dependent detail ──
  if (includeFullObjects) {
    const detailObjects = selectDetailObjects(
      allObjects,
      scope,
      viewport,
      selectedSet,
      maxDetail
    );

    if (detailObjects.length > 0) {
      lines.push("");
      const label =
        scope === "viewport"
          ? "Visible objects"
          : scope === "selected"
            ? "Context objects"
            : "All objects";
      lines.push(`${label} (${detailObjects.length}):`);
      for (const obj of detailObjects) {
        lines.push("  " + formatObjectLine(obj));
      }

      const omitted = allObjects.length - detailObjects.length - selected.length;
      if (omitted > 0) {
        lines.push(`  ... and ${omitted} more (use getBoardContext to fetch)`);
      }
    }
  } else {
    // No full objects — just tell the model it can ask
    const nonFrameNonSelected = allObjects.filter(
      (o) => o.type !== "frame" && !selectedSet.has(o.id)
    );
    if (nonFrameNonSelected.length > 0) {
      lines.push("");
      lines.push(
        `${nonFrameNonSelected.length} additional objects not shown. Use getBoardContext to fetch details when needed.`
      );
    }
  }

  return lines.join("\n");
}

// ─── Internals ────────────────────────────────────────────────

function countByType(objects: CompactObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of objects) {
    counts[o.type] = (counts[o.type] || 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
    .join(", ");
}

function buildFrameInfos(objects: CompactObject[]): FrameInfo[] {
  const frames = objects.filter((o) => o.type === "frame");
  return frames.map((f) => {
    const children = objects.filter(
      (o) => o.parentFrameId === f.id && o.id !== f.id
    );
    return {
      id: f.id,
      title: f.text || "(untitled)",
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      childCount: children.length,
      children,
    };
  });
}

function selectDetailObjects(
  allObjects: CompactObject[],
  scope: Scope,
  viewport: Viewport,
  selectedSet: Set<string>,
  maxDetail: number
): CompactObject[] {
  // Don't re-include selected or frames (already shown)
  const candidates = allObjects.filter(
    (o) => !selectedSet.has(o.id) && o.type !== "frame"
  );

  if (scope === "selected") {
    // Only show frame children of selected frames
    const selectedFrameIds = new Set(
      allObjects
        .filter((o) => selectedSet.has(o.id) && o.type === "frame")
        .map((o) => o.id)
    );
    if (selectedFrameIds.size === 0) return [];
    return candidates
      .filter((o) => o.parentFrameId && selectedFrameIds.has(o.parentFrameId))
      .slice(0, maxDetail);
  }

  if (scope === "viewport") {
    const margin = 200;
    return candidates
      .filter((o) => {
        const r = o.x + o.width;
        const b = o.y + o.height;
        return (
          o.x < viewport.maxX + margin &&
          r > viewport.minX - margin &&
          o.y < viewport.maxY + margin &&
          b > viewport.minY - margin
        );
      })
      .slice(0, maxDetail);
  }

  // scope === "board" — include everything up to limit
  return candidates.slice(0, maxDetail);
}

/**
 * Format a single object as a compact, token-lean line.
 * Example: `OBJ abc123 sticky pos=(120,80) 150×150 c=#FBBF24 p=frame1 "Buy groceries"`
 */
function formatObjectLine(obj: CompactObject): string {
  const parts = [
    `OBJ ${shortId(obj.id)}`,
    obj.type,
    `pos=(${r(obj.x)},${r(obj.y)})`,
    `${r(obj.width)}×${r(obj.height)}`,
  ];

  if (obj.color) parts.push(`c=${obj.color}`);
  if (obj.parentFrameId) parts.push(`p=${shortId(obj.parentFrameId)}`);
  if (obj.text) parts.push(`"${obj.text.slice(0, 60)}"`);

  return parts.join(" ");
}

/** Full UUID — the model needs exact IDs for tool calls */
function shortId(id: string): string {
  return id;
}

function r(n: number): number {
  return Math.round(n);
}
