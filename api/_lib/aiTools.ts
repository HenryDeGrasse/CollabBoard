/**
 * AI Agent Tool Definitions + Execution Layer
 *
 * This module is the public API consumed by aiAgent.ts and the route handlers.
 * Implementation is split across focused modules in api/_lib/ai/:
 *
 *   ai/toolDefinitions.ts  — OpenAI function-calling schemas (pure data)
 *   ai/toolHelpers.ts      — Shared helpers (colors, defaults, patching, navigation)
 *   ai/systemPrompt.ts     — Agent system prompt (easy to iterate)
 *   ai/models.ts           — Model names configurable via env vars
 *   ai/rateLimit.ts        — In-memory sliding-window rate limiter
 *
 * The executeTool() dispatcher and all per-tool execution logic remain here
 * to avoid changing call sites. The tool schemas and helpers have been extracted
 * to keep this file focused on execution.
 */
import OpenAI from "openai";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

// ── Re-exports: public API consumed by aiAgent.ts / route handlers ──
export { TOOL_DEFINITIONS } from "./ai/toolDefinitions.js";
export { MODEL_SIMPLE, MODEL_COMPLEX, MODEL_CONTENT, MODEL_FASTPATH } from "./ai/models.js";
export { SYSTEM_PROMPT } from "./ai/systemPrompt.js";
export { checkRateLimit, resetRateLimits } from "./ai/rateLimit.js";

import { MODEL_CONTENT } from "./ai/models.js";
import {
  resolveColor,
  colorLabel,
  TYPE_DEFAULTS,
  computeNavigationViewport,
  findOpenCanvasSpace,
  annotateObjectRow,
  annotateConnectorRow,
  applyObjectPatches,
  repositionObjects,
  PATCH_BULK_CHUNK_SIZE,
  type ToolContext,
} from "./ai/toolHelpers.js";

// Re-export helpers that other modules depend on
export {
  resolveColor,
  colorLabel,
  computeNavigationViewport,
  findOpenCanvasSpace,
  annotateObjectRow,
  annotateConnectorRow,
  type ToolContext,
};

function generateUUID(): string {
  return crypto.randomUUID();
}

// ─── Tool Execution ────────────────────────────────────────────

export interface ToolResult {
  name: string;
  result: unknown;
}

/**
 * Execute a single tool call against the database.
 * Returns a JSON-serializable result for the LLM.
 * Results with a `_viewport` key signal the agent to emit a navigate event.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  boardId: string,
  userId: string,
  context: ToolContext = {},
  openaiApiKey?: string
): Promise<unknown> {
  const supabase = getSupabaseAdmin();

  switch (toolName) {
    // ── Create Objects ────────────────────────────────────
    case "create_objects": {
      const objects: any[] = args.objects || [];
      const now = new Date().toISOString();
      const baseZIndex = Date.now();
      const createdIds: string[] = [];

      const rows = objects.map((obj: any, i: number) => {
        const defaults = TYPE_DEFAULTS[obj.type] || TYPE_DEFAULTS.rectangle;
        return {
          board_id: boardId,
          type: obj.type,
          x: obj.x ?? 0,
          y: obj.y ?? 0,
          width: obj.width ?? defaults.width,
          height: obj.height ?? defaults.height,
          color: (obj.color ? resolveColor(obj.color) : null) || defaults.color,
          text: obj.text ?? "",
          rotation: obj.rotation ?? 0,
          z_index: baseZIndex + i,
          created_by: userId,
          parent_frame_id: obj.parentFrameId || null,
          created_at: now,
          updated_at: now,
        };
      });

      const { data, error } = await supabase
        .from("objects")
        .insert(rows)
        .select("id, type, x, y, width, height");

      if (error) return { error: error.message };

      const createdObjects: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }> = [];
      for (const row of data || []) {
        createdIds.push(row.id);
        createdObjects.push({ id: row.id, type: row.type, x: row.x, y: row.y, width: row.width, height: row.height });
      }

      const _viewport = computeNavigationViewport(createdObjects, context.screenSize);
      return {
        created: createdIds.length,
        ids: createdIds,
        objects: createdObjects,
        message: `Created ${createdIds.length} object(s)`,
        ...(_viewport ? { _viewport } : {}),
      };
    }

    // ── Bulk Create Objects ─────────────────────────────
    case "bulk_create_objects": {
      const objType: string = args.type || "sticky";
      const count: number = Math.min(Math.max(args.count || 0, 1), 500);
      const parentFrameId: string | null = args.parentFrameId || null;
      const layout: string = args.layout || (parentFrameId ? "vertical" : "grid");
      const gap: number = args.gap ?? 20;
      let startX: number = args.startX ?? context.viewportCenter?.x ?? 100;
      let startY: number = args.startY ?? context.viewportCenter?.y ?? 100;
      const contentPrompt: string | undefined = args.contentPrompt;
      const textPattern: string | undefined = args.textPattern;

      const defaults = TYPE_DEFAULTS[objType] || TYPE_DEFAULTS.rectangle;
      const objWidth: number = args.width ?? defaults.width;
      const objHeight: number = args.height ?? defaults.height;
      const color: string = (args.color ? resolveColor(args.color) : null) || defaults.color;

      if (parentFrameId) {
        const { data: frameAndKids } = await supabase
          .from("objects")
          .select("id, type, x, y, width, height")
          .eq("board_id", boardId)
          .or(`id.eq.${parentFrameId},parent_frame_id.eq.${parentFrameId}`);

        if (frameAndKids && frameAndKids.length > 0) {
          const frame = frameAndKids.find((o: any) => o.id === parentFrameId);
          const kids = frameAndKids.filter((o: any) => o.id !== parentFrameId);

          if (frame) {
            startX = frame.x + 30;
            if (kids.length > 0) {
              const maxY = Math.max(...kids.map((k: any) => k.y + k.height));
              startY = maxY + gap;
            } else {
              startY = frame.y + 60;
            }
          }
        }
      }

      const columns: number =
        layout === "vertical" ? 1
        : layout === "horizontal" ? count
        : args.columns ?? Math.ceil(Math.sqrt(count));

      const positions: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < count; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        positions.push({
          x: startX + col * (objWidth + gap),
          y: startY + row * (objHeight + gap),
        });
      }

      let texts: string[] = [];
      if (contentPrompt && openaiApiKey) {
        try {
          const openai = new OpenAI({ apiKey: openaiApiKey });
          const resp = await openai.chat.completions.create({
            model: MODEL_CONTENT,
            temperature: 0.9,
            max_tokens: Math.min(count * 60, 16000),
            messages: [
              { role: "system", content: "You generate short text items. Return ONLY a JSON array of strings, no other text. Each string should be concise (under 80 characters). No numbering or prefixes." },
              { role: "user", content: `Generate exactly ${count} unique items. Each item should be: ${contentPrompt}` },
            ],
          });

          const raw = resp.choices[0]?.message?.content?.trim() ?? "[]";
          const jsonStr = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
          try {
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) texts = parsed.map((item: any) => String(item));
          } catch {
            texts = raw.split("\n").map((line: string) => line.replace(/^\d+[\.\)]\s*/, "").trim()).filter((line: string) => line.length > 0);
          }
        } catch {
          texts = [];
        }
      }

      if (texts.length === 0 && textPattern) {
        texts = Array.from({ length: count }, (_, i) => textPattern.replace(/\{i\}/g, String(i + 1)));
      }

      while (texts.length < count) texts.push("");

      const now = new Date().toISOString();
      const baseZIndex = Date.now();

      const rows = positions.map((pos, i) => ({
        board_id: boardId, type: objType, x: pos.x, y: pos.y,
        width: objWidth, height: objHeight, color, text: texts[i] ?? "",
        rotation: 0, z_index: baseZIndex + i, created_by: userId,
        parent_frame_id: parentFrameId, created_at: now, updated_at: now,
      }));

      const { data, error } = await supabase.from("objects").insert(rows).select("id");
      if (error) return { error: error.message };

      if (parentFrameId) {
        await executeTool("fit_frames_to_contents", { padding: 30 }, boardId, userId, context, openaiApiKey);
      }

      const createdIds = (data || []).map((r: any) => r.id);
      return {
        created: createdIds.length, ids: createdIds,
        message: `Bulk-created ${createdIds.length} ${objType} object(s)${parentFrameId ? ' and resized frames' : ''}`,
      };
    }

    // ── Create Quadrant Layout ────────────────────────────
    case "createQuadrant": {
      const { title, xAxisLabel, yAxisLabel, quadrantLabels, items, quadrantSourceIds } = args;
      const startX = args.startX ?? context.viewportCenter?.x ?? 100;
      const startY = args.startY ?? context.viewportCenter?.y ?? 100;
      const now = new Date().toISOString();
      let zIndex = Date.now();

      const stickyWidth = 150, stickyHeight = 150, gap = 20, quadrantPadding = 30;

      const getGridSize = (count: number) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
        const rows = Math.max(1, Math.ceil(count / cols));
        return { cols, rows };
      };

      // ── Reposition mode ──
      if (quadrantSourceIds && typeof quadrantSourceIds === "object") {
        const qSrcTL: string[] = quadrantSourceIds.topLeft || [];
        const qSrcTR: string[] = quadrantSourceIds.topRight || [];
        const qSrcBL: string[] = quadrantSourceIds.bottomLeft || [];
        const qSrcBR: string[] = quadrantSourceIds.bottomRight || [];
        const allIds = [...qSrcTL, ...qSrcTR, ...qSrcBL, ...qSrcBR];

        if (allIds.length > 0) {
          const { data: srcObjs } = await supabase.from("objects").select("id, width, height").eq("board_id", boardId).in("id", allIds);
          if (!srcObjs || srcObjs.length === 0) return { error: "None of the quadrantSourceIds objects were found on this board." };

          const tlGrid = getGridSize(qSrcTL.length), trGrid = getGridSize(qSrcTR.length);
          const blGrid = getGridSize(qSrcBL.length), brGrid = getGridSize(qSrcBR.length);
          const maxTopRows = Math.max(tlGrid.rows, trGrid.rows, 2);
          const maxBottomRows = Math.max(blGrid.rows, brGrid.rows, 2);
          const maxLeftCols = Math.max(tlGrid.cols, blGrid.cols, 2);
          const maxRightCols = Math.max(trGrid.cols, brGrid.cols, 2);

          const minQW = 2 * stickyWidth + gap + quadrantPadding * 2;
          const minQH = 2 * stickyHeight + gap + quadrantPadding * 2 + 60;
          const qWidthLeft = Math.max(maxLeftCols * stickyWidth + (maxLeftCols - 1) * gap + quadrantPadding * 2, minQW);
          const qWidthRight = Math.max(maxRightCols * stickyWidth + (maxRightCols - 1) * gap + quadrantPadding * 2, minQW);
          const qHeightTop = Math.max(maxTopRows * stickyHeight + (maxTopRows - 1) * gap + quadrantPadding * 2 + 60, minQH);
          const qHeightBottom = Math.max(maxBottomRows * stickyHeight + (maxBottomRows - 1) * gap + quadrantPadding * 2 + 60, minQH);
          const totalWidth = qWidthLeft + qWidthRight + gap;
          const totalHeight = qHeightTop + qHeightBottom + gap;

          const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, totalHeight + 80, startX, startY);
          let totalCreated = 0;
          const quadrantIds: Record<string, string> = {};

          const { data: masterData, error: masterErr } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80, color: "#F9F9F7", text: title || "Quadrant Layout", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
          if (masterErr || !masterData) return { error: masterErr?.message || "Failed to create master frame" };
          const masterFrameId = masterData.id;
          totalCreated++;

          const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
          const buildQuadrantRepos = async (qTitle: string, srcIds: string[], qX: number, qY: number, qWidth: number, qHeight: number, qCols: number, key: string) => {
            const { data: qData, error: qErr } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: qX, y: qY, width: qWidth, height: qHeight, color: "#F9F9F7", text: qTitle || key, parent_frame_id: masterFrameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
            if (qErr || !qData) throw new Error(qErr?.message || "Failed to create quadrant frame");
            quadrantIds[key] = qData.id;
            totalCreated++;
            for (let i = 0; i < srcIds.length; i++) {
              const col = i % qCols, row = Math.floor(i / qCols);
              patches.push({ id: srcIds[i], x: qX + quadrantPadding + col * (stickyWidth + gap), y: qY + 60 + row * (stickyHeight + gap), parentFrameId: qData.id });
            }
          };

          try {
            const six = pos.x + 20, siy = pos.y + 60;
            await buildQuadrantRepos(quadrantLabels?.topLeft, qSrcTL, six, siy, qWidthLeft, qHeightTop, tlGrid.cols, "topLeft");
            await buildQuadrantRepos(quadrantLabels?.topRight, qSrcTR, six + qWidthLeft + gap, siy, qWidthRight, qHeightTop, trGrid.cols, "topRight");
            await buildQuadrantRepos(quadrantLabels?.bottomLeft, qSrcBL, six, siy + qHeightTop + gap, qWidthLeft, qHeightBottom, blGrid.cols, "bottomLeft");
            await buildQuadrantRepos(quadrantLabels?.bottomRight, qSrcBR, six + qWidthLeft + gap, siy + qHeightTop + gap, qWidthRight, qHeightBottom, brGrid.cols, "bottomRight");
          } catch (err: any) { return { error: err.message }; }

          const moved = await repositionObjects(supabase, boardId, patches);
          const _qViewport = computeNavigationViewport([{ x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80 }], context.screenSize);
          return { created: totalCreated, repositioned: moved, frameId: masterFrameId, quadrantIds, message: `Reorganized ${moved} objects into quadrant layout with ${totalCreated} new frames.`, ...(_qViewport ? { _viewport: _qViewport } : {}) };
        }
      }

      // ── Normal create mode ──
      const tlItems: string[] = items?.topLeft || [], trItems: string[] = items?.topRight || [];
      const blItems: string[] = items?.bottomLeft || [], brItems: string[] = items?.bottomRight || [];
      const tlGrid = getGridSize(tlItems.length), trGrid = getGridSize(trItems.length);
      const blGrid = getGridSize(blItems.length), brGrid = getGridSize(brItems.length);
      const maxTopRows = Math.max(tlGrid.rows, trGrid.rows), maxBottomRows = Math.max(blGrid.rows, brGrid.rows);
      const maxLeftCols = Math.max(tlGrid.cols, blGrid.cols), maxRightCols = Math.max(trGrid.cols, brGrid.cols);
      const minQuadrantWidth = 2 * stickyWidth + gap + quadrantPadding * 2;
      const minQuadrantHeight = 2 * stickyHeight + gap + quadrantPadding * 2 + 60;
      const qWidthLeft = Math.max(maxLeftCols * stickyWidth + (maxLeftCols - 1) * gap + quadrantPadding * 2, minQuadrantWidth);
      const qWidthRight = Math.max(maxRightCols * stickyWidth + (maxRightCols - 1) * gap + quadrantPadding * 2, minQuadrantWidth);
      const qHeightTop = Math.max(maxTopRows * stickyHeight + (maxTopRows - 1) * gap + quadrantPadding * 2 + 60, minQuadrantHeight);
      const qHeightBottom = Math.max(maxBottomRows * stickyHeight + (maxBottomRows - 1) * gap + quadrantPadding * 2 + 60, minQuadrantHeight);
      const totalWidth = qWidthLeft + qWidthRight + gap;
      const totalHeight = qHeightTop + qHeightBottom + gap;

      const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, totalHeight + 80, startX, startY);
      let parentFrameId: string | null = null;
      let totalCreated = 0;
      const quadrantIds: Record<string, string> = {};

      const { data: masterData, error: masterErr } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80, color: "#F9F9F7", text: title || "Quadrant Layout", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
      if (masterErr || !masterData) return { error: masterErr?.message || "Failed to create master frame" };
      parentFrameId = masterData.id;
      totalCreated++;

      const children: any[] = [];
      if (xAxisLabel) children.push({ board_id: boardId, type: "text", x: pos.x + (totalWidth + 40) / 2 - 100, y: pos.y + totalHeight + 80 - 40, width: 200, height: 40, text: xAxisLabel, color: "#111111", parent_frame_id: parentFrameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now });
      if (yAxisLabel) children.push({ board_id: boardId, type: "text", x: pos.x - 60, y: pos.y + (totalHeight + 80) / 2 - 100, width: 200, height: 40, text: yAxisLabel, color: "#111111", parent_frame_id: parentFrameId, rotation: -90, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now });
      if (children.length > 0) {
        const { error: childErr } = await supabase.from("objects").insert(children);
        if (childErr) return { error: childErr.message };
        totalCreated += children.length;
      }

      const buildQuadrant = async (qTitle: string, qItems: string[], qX: number, qY: number, qWidth: number, qHeight: number, color: string, qCols: number, key: string) => {
        const { data: qData, error: qErr } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: qX, y: qY, width: qWidth, height: qHeight, color: "#F9F9F7", text: qTitle || key, parent_frame_id: parentFrameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
        if (qErr || !qData) throw new Error(qErr?.message || "Failed to create quadrant frame");
        quadrantIds[key] = qData.id;
        totalCreated++;
        if (qItems.length > 0) {
          const stickyRows = qItems.map((itemText, i) => { const col = i % qCols, row = Math.floor(i / qCols); return { board_id: boardId, type: "sticky", x: qX + quadrantPadding + col * (stickyWidth + gap), y: qY + 60 + row * (stickyHeight + gap), width: stickyWidth, height: stickyHeight, text: itemText, color, parent_frame_id: qData.id, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }; });
          const { error: stickyErr } = await supabase.from("objects").insert(stickyRows);
          if (stickyErr) throw new Error(stickyErr.message);
          totalCreated += stickyRows.length;
        }
      };

      try {
        const six = pos.x + 20, siy = pos.y + 60;
        await buildQuadrant(quadrantLabels?.topLeft, tlItems, six, siy, qWidthLeft, qHeightTop, "#9DD9A3", tlGrid.cols, "topLeft");
        await buildQuadrant(quadrantLabels?.topRight, trItems, six + qWidthLeft + gap, siy, qWidthRight, qHeightTop, "#FAD84E", trGrid.cols, "topRight");
        await buildQuadrant(quadrantLabels?.bottomLeft, blItems, six, siy + qHeightTop + gap, qWidthLeft, qHeightBottom, "#7FC8E8", blGrid.cols, "bottomLeft");
        await buildQuadrant(quadrantLabels?.bottomRight, brItems, six + qWidthLeft + gap, siy + qHeightTop + gap, qWidthRight, qHeightBottom, "#F5A8C4", brGrid.cols, "bottomRight");
      } catch (err: any) { return { error: err.message }; }

      const _qViewport = computeNavigationViewport([{ x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80 }], context.screenSize);
      return { created: totalCreated, frameId: parentFrameId, quadrantIds, message: `Created quadrant layout with ${totalCreated} objects.`, ...(_qViewport ? { _viewport: _qViewport } : {}) };
    }

    // ── Create Column Layout ────────────────────────────
    case "createColumnLayout":
      return executeColumnLayout(args, boardId, userId, context, openaiApiKey);

    // ── Create Connectors ────────────────────────────────
    case "create_connectors": {
      const connectors: any[] = args.connectors || [];
      const rows = connectors.map((conn: any) => ({ board_id: boardId, from_id: conn.fromId || null, to_id: conn.toId || null, style: conn.style || "arrow", from_point: conn.fromPoint ?? null, to_point: conn.toPoint ?? null, color: (conn.color ? resolveColor(conn.color) : null) ?? null, stroke_width: conn.strokeWidth ?? null }));
      const { data, error } = await supabase.from("connectors").insert(rows).select("id");
      if (error) return { error: error.message };
      const ids = (data || []).map((r: any) => r.id);
      return { created: ids.length, ids, message: `Created ${ids.length} connector(s)` };
    }

    // ── Update Objects ───────────────────────────────────
    case "update_objects": {
      const patches: any[] = args.patches || [];
      const now = new Date().toISOString();
      const { results, succeeded } = await applyObjectPatches(supabase, boardId, patches, now);
      return { updated: succeeded, results, message: `Updated ${succeeded}/${patches.length} object(s)` };
    }

    // ── Delete Objects ───────────────────────────────────
    case "delete_objects": {
      const ids: string[] = args.ids || [];
      if (ids.length > 0) {
        await supabase.from("connectors").delete().eq("board_id", boardId).or(ids.map((id) => `from_id.eq.${id}`).join(",") + "," + ids.map((id) => `to_id.eq.${id}`).join(","));
      }
      const { error } = await supabase.from("objects").delete().eq("board_id", boardId).in("id", ids);
      if (error) return { error: error.message };
      return { deleted: ids.length, message: `Deleted ${ids.length} object(s)` };
    }

    // ── Delete by filter ────────────────────────────────
    case "delete_objects_by_filter": {
      const filterType: string | undefined = args.type;
      const filterColor: string | undefined = args.color;
      if (!filterType && !filterColor) return { error: "Provide at least one of: type, color" };
      let hexColor: string | null = null;
      if (filterColor) { hexColor = resolveColor(filterColor); if (!hexColor) return { error: `Unrecognised color "${filterColor}". Use a name (purple, yellow…) or hex (#A855F7).` }; }
      let query = supabase.from("objects").select("id").eq("board_id", boardId);
      if (filterType) query = query.eq("type", filterType);
      if (hexColor) query = query.ilike("color", hexColor);
      const { data: matches, error: selErr } = await query;
      if (selErr) return { error: selErr.message };
      const ids = (matches || []).map((r: any) => r.id);
      if (ids.length === 0) { const desc = [filterType, filterColor ? `${filterColor} (${hexColor})` : null].filter(Boolean).join(" "); return { deleted: 0, message: `No ${desc} objects found on the board.` }; }
      await supabase.from("connectors").delete().eq("board_id", boardId).or(ids.map((id: string) => `from_id.eq.${id}`).join(",") + "," + ids.map((id: string) => `to_id.eq.${id}`).join(","));
      const { error: delErr } = await supabase.from("objects").delete().eq("board_id", boardId).in("id", ids);
      if (delErr) return { error: delErr.message };
      return { deleted: ids.length, message: `Deleted ${ids.length} object(s).` };
    }

    // ── Delete Connectors ────────────────────────────────
    case "delete_connectors": {
      const ids: string[] = args.ids || [];
      const { error } = await supabase.from("connectors").delete().eq("board_id", boardId).in("id", ids);
      if (error) return { error: error.message };
      return { deleted: ids.length, message: `Deleted ${ids.length} connector(s)` };
    }

    // ── Update by filter ─────────────────────────────────
    case "update_objects_by_filter": {
      const filter = args.filter || {}; const updates = args.updates || {};
      if (!filter.type && !filter.color) return { error: "filter must include at least one of: type, color" };
      if (Object.keys(updates).length === 0) return { error: "updates must include at least one field to change" };
      let hexFilter: string | null = null;
      if (filter.color) { hexFilter = resolveColor(filter.color); if (!hexFilter) return { error: `Unrecognised color "${filter.color}"` }; }
      let query = supabase.from("objects").select("id").eq("board_id", boardId);
      if (filter.type) query = query.eq("type", filter.type);
      if (hexFilter) query = query.ilike("color", hexFilter);
      const { data: matches, error: selErr } = await query;
      if (selErr) return { error: selErr.message };
      const ids = (matches || []).map((r: any) => r.id);
      if (ids.length === 0) return { updated: 0, message: "No matching objects found." };
      const row: Record<string, any> = { updated_at: new Date().toISOString() };
      if (updates.color !== undefined) row.color = resolveColor(updates.color) ?? updates.color;
      if (updates.text !== undefined) row.text = updates.text;
      if (updates.width !== undefined) row.width = updates.width;
      if (updates.height !== undefined) row.height = updates.height;
      if (updates.rotation !== undefined) row.rotation = updates.rotation;
      const { error: updErr } = await supabase.from("objects").update(row).eq("board_id", boardId).in("id", ids);
      if (updErr) return { error: updErr.message };
      return { updated: ids.length, message: `Updated ${ids.length} object(s).` };
    }

    // ── Fit frames to contents ────────────────────────────
    case "fit_frames_to_contents": {
      const padding: number = args.padding ?? 40;
      const TITLE_EXTRA = 30;
      let frameIds: string[] = args.ids ?? [];
      if (frameIds.length === 0) { const { data } = await supabase.from("objects").select("id").eq("board_id", boardId).eq("type", "frame"); frameIds = (data || []).map((r: any) => r.id); }
      if (frameIds.length === 0) return { message: "No frames found on the board." };
      const { data: allObjects } = await supabase.from("objects").select("id, type, x, y, width, height, parent_frame_id").eq("board_id", boardId);
      const objects = allObjects || [];
      const objMap = new Map(objects.map(o => [o.id, o]));
      const childrenByParent = new Map<string, any[]>();
      for (const obj of objects) { if (obj.parent_frame_id) { if (!childrenByParent.has(obj.parent_frame_id)) childrenByParent.set(obj.parent_frame_id, []); childrenByParent.get(obj.parent_frame_id)!.push(obj); } }
      const getDepth = (id: string, visited = new Set<string>()): number => { if (visited.has(id)) return 0; visited.add(id); const obj = objMap.get(id); if (!obj || !obj.parent_frame_id) return 0; return 1 + getDepth(obj.parent_frame_id, visited); };
      const framesToFit = frameIds.map(id => ({ id, depth: getDepth(id) })).sort((a, b) => b.depth - a.depth);
      const now = new Date().toISOString();
      let fittedCount = 0, skippedCount = 0;
      for (const { id: frameId } of framesToFit) {
        const kids = childrenByParent.get(frameId) || [];
        if (kids.length === 0) { skippedCount++; continue; }
        const currentKids = kids.map(k => objMap.get(k.id)!);
        const minX = Math.min(...currentKids.map(c => c.x)), minY = Math.min(...currentKids.map(c => c.y));
        const maxX = Math.max(...currentKids.map(c => c.x + c.width)), maxY = Math.max(...currentKids.map(c => c.y + c.height));
        const newX = minX - padding, newY = minY - padding - TITLE_EXTRA;
        const newWidth = (maxX - minX) + padding * 2, newHeight = (maxY - minY) + padding * 2 + TITLE_EXTRA;
        await supabase.from("objects").update({ x: newX, y: newY, width: newWidth, height: newHeight, updated_at: now }).eq("id", frameId);
        const frameObj = objMap.get(frameId);
        if (frameObj) { frameObj.x = newX; frameObj.y = newY; frameObj.width = newWidth; frameObj.height = newHeight; }
        fittedCount++;
      }
      let msg = `Fitted ${fittedCount}/${frameIds.length} frame(s).`;
      if (skippedCount > 0) msg += ` Skipped ${skippedCount} frame(s) because they had no children.`;
      return { fitted: fittedCount, skipped: skippedCount, total: frameIds.length, message: msg };
    }

    // ── Clear board ───────────────────────────────────────
    case "clear_board": {
      const { error: cErr } = await supabase.from("connectors").delete().eq("board_id", boardId);
      if (cErr) return { error: cErr.message };
      const { error: oErr } = await supabase.from("objects").delete().eq("board_id", boardId);
      if (oErr) return { error: oErr.message };
      return { message: "Board cleared." };
    }

    // ── Navigate to objects ───────────────────────────────
    case "navigate_to_objects": {
      const targetIds: string[] | undefined = args.ids?.length ? args.ids : undefined;
      let query = supabase.from("objects").select("x, y, width, height").eq("board_id", boardId);
      if (targetIds) query = query.in("id", targetIds);
      const { data: objs } = await query;
      if (!objs || objs.length === 0) return { error: "No objects found to navigate to." };
      const minX = Math.min(...objs.map((o: any) => o.x)), minY = Math.min(...objs.map((o: any) => o.y));
      const maxX = Math.max(...objs.map((o: any) => o.x + o.width)), maxY = Math.max(...objs.map((o: any) => o.y + o.height));
      const sw = context.screenSize?.width ?? 1280, sh = context.screenSize?.height ?? 800;
      const pad = args.padding ?? 0.82;
      const scale = Math.min(Math.max(Math.min((sw * pad) / Math.max(maxX - minX, 1), (sh * pad) / Math.max(maxY - minY, 1)), 0.1), 2.0);
      const viewport = { x: Math.round(sw / 2 - ((minX + maxX) / 2) * scale), y: Math.round(sh / 2 - ((minY + maxY) / 2) * scale), scale: Math.round(scale * 1000) / 1000 };
      return { _viewport: viewport, message: `Navigating to ${objs.length} object(s).` };
    }

    // ── Arrange objects ───────────────────────────────────
    case "arrange_objects":
      return executeArrangeObjects(args, boardId, context);

    // ── Duplicate objects ─────────────────────────────────
    case "duplicate_objects":
      return executeDuplicateObjects(args, boardId, userId, context);

    // ── Search objects ────────────────────────────────────
    case "search_objects":
      return executeSearchObjects(args, boardId);

    // ── Scoped board context ───────────────────────────────
    case "get_board_context":
      return executeGetBoardContext(args, boardId, context);

    // ── Create Wireframe ───────────────────────────────────
    case "createWireframe":
      return executeCreateWireframe(args, boardId, userId, context);

    // ── Create Mind Map ──────────────────────────────────────
    case "createMindMap":
      return executeCreateMindMap(args, boardId, userId, context, openaiApiKey);

    // ── Create Flowchart ─────────────────────────────────────
    case "createFlowchart":
      return executeCreateFlowchart(args, boardId, userId, context);

    // ── Read Board State ─────────────────────────────────────
    case "read_board_state":
      return await fetchBoardState(boardId);

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── Delegated Executors (extracted to reduce switch body size) ──

async function executeColumnLayout(args: Record<string, any>, boardId: string, userId: string, context: ToolContext, _openaiApiKey?: string) {
  const supabase = getSupabaseAdmin();
  const { title, columns, sourceIds: colSourceIds } = args;
  if (!Array.isArray(columns) || columns.length === 0) return { error: "columns array is required and cannot be empty" };
  const startX = args.startX ?? context.viewportCenter?.x ?? 100;
  const startY = args.startY ?? context.viewportCenter?.y ?? 100;
  const now = new Date().toISOString();
  let zIndex = Date.now();
  const stickyWidth = 150, stickyHeight = 150, gap = 20, colPadding = 30;

  if (Array.isArray(colSourceIds) && colSourceIds.length > 0) {
    const allObjIds = colSourceIds.flatMap((s: any) => s.objectIds || []);
    const { data: srcObjs } = await supabase.from("objects").select("id, width, height").eq("board_id", boardId).in("id", allObjIds);
    if (!srcObjs || srcObjs.length === 0) return { error: "None of the sourceIds objects were found on this board." };
    const objMap = new Map(srcObjs.map((o: any) => [o.id, o]));
    const maxPerCol = Math.max(...colSourceIds.map((s: any) => (s.objectIds || []).length), 0);
    const colWidth = stickyWidth + colPadding * 2;
    const totalWidth = columns.length * (colWidth + gap) - gap;
    const itemCount = Math.max(maxPerCol, 4);
    const colHeight = itemCount * stickyHeight + (itemCount - 1) * gap + colPadding * 2 + 60;
    const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, colHeight + 80, startX, startY);
    const colors = ["#E5E5E0", "#7FC8E8", "#FAD84E", "#9DD9A3", "#F5A8C4"];
    let masterFrameId: string | null = null;
    let totalCreated = 0;
    const columnIds: Record<string, string> = {};
    if (title) {
      const { data: md, error: me } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: pos.x, y: pos.y, width: totalWidth + 40, height: colHeight + 80, color: "#F9F9F7", text: title, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
      if (me || !md) return { error: me?.message || "Failed to create master frame" };
      masterFrameId = md.id; totalCreated++;
    }
    const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
    const colSourceMap = new Map(colSourceIds.map((s: any) => [s.columnTitle, s.objectIds || []]));
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      const col = columns[colIdx];
      const cx = pos.x + 20 + colIdx * (colWidth + gap), cy = pos.y + 60;
      const { data: cd, error: ce } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: cx, y: cy, width: colWidth, height: colHeight, color: "#F9F9F7", text: col.title || `Column ${colIdx + 1}`, parent_frame_id: masterFrameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
      if (ce || !cd) continue;
      columnIds[col.title || `Column ${colIdx + 1}`] = cd.id; totalCreated++;
      const idsForCol: string[] = colSourceMap.get(col.title) || [];
      for (let i = 0; i < idsForCol.length; i++) { if (!objMap.has(idsForCol[i])) continue; patches.push({ id: idsForCol[i], x: cx + colPadding, y: cy + 60 + i * (stickyHeight + gap), parentFrameId: cd.id }); }
    }
    const moved = await repositionObjects(supabase, boardId, patches);
    const _v = computeNavigationViewport([{ x: pos.x, y: pos.y, width: totalWidth + 40, height: colHeight + 80 }], context.screenSize);
    return { created: totalCreated, repositioned: moved, frameId: masterFrameId ?? undefined, columnIds, message: `Reorganized ${moved} objects into column layout with ${totalCreated} new frames.`, ...(_v ? { _viewport: _v } : {}) };
  }

  // Normal create mode
  const maxItems = Math.max(...columns.map((c: any) => Array.isArray(c.items) ? c.items.length : 0));
  const colWidth = stickyWidth + colPadding * 2;
  const totalWidth = columns.length * (colWidth + gap) - gap;
  const colHeight = Math.max(maxItems * stickyHeight + (maxItems > 0 ? (maxItems - 1) * gap : 0) + colPadding * 2 + 60, 4 * stickyHeight + 3 * gap + colPadding * 2 + 60);
  const pos = await findOpenCanvasSpace(boardId, totalWidth, colHeight, startX, startY);
  const colors = ["#E5E5E0", "#7FC8E8", "#FAD84E", "#9DD9A3", "#F5A8C4"];
  let parentFrameId: string | null = null;
  let totalCreated = 0;
  const columnIds: Record<string, string> = {};
  if (title) {
    const { data: md, error: me } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: pos.x, y: pos.y, width: totalWidth + 40, height: colHeight + 80, color: "#F9F9F7", text: title, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
    if (me || !md) return { error: me?.message || "Failed to create master frame" };
    parentFrameId = md.id; totalCreated++;
  }
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const col = columns[colIdx];
    const cx = pos.x + 20 + colIdx * (colWidth + gap), cy = pos.y + 60;
    const color = colors[colIdx % colors.length];
    const { data: cd, error: ce } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: cx, y: cy, width: colWidth, height: colHeight, color: "#F9F9F7", text: col.title || `Column ${colIdx + 1}`, parent_frame_id: parentFrameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
    if (ce || !cd) return { error: ce?.message || "Failed to create column frame" };
    columnIds[col.title || `Column ${colIdx + 1}`] = cd.id; totalCreated++;
    const items: string[] = Array.isArray(col.items) ? col.items : [];
    if (items.length > 0) {
      const rows = items.map((t: string, i: number) => ({ board_id: boardId, type: "sticky", x: cx + colPadding, y: cy + 60 + i * (stickyHeight + gap), width: stickyWidth, height: stickyHeight, text: t, color, parent_frame_id: cd.id, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }));
      const { error: se } = await supabase.from("objects").insert(rows);
      if (se) return { error: se.message };
      totalCreated += rows.length;
    }
  }
  const bounds = parentFrameId ? [{ x: pos.x, y: pos.y, width: totalWidth + 40, height: colHeight + 80 }] : [{ x: pos.x, y: pos.y, width: totalWidth, height: colHeight }];
  const _v = computeNavigationViewport(bounds, context.screenSize);
  return { created: totalCreated, frameId: parentFrameId ?? undefined, columnIds, message: `Created column layout with ${totalCreated} objects.`, ...(_v ? { _viewport: _v } : {}) };
}

async function executeArrangeObjects(args: Record<string, any>, boardId: string, context: ToolContext) {
  const supabase = getSupabaseAdmin();
  const rawIds: string[] | undefined = args.ids?.length ? args.ids : context.selectedIds?.length ? context.selectedIds : undefined;
  if (!rawIds || rawIds.length < 2) return { error: "Need at least 2 object IDs. Pass ids or select objects first." };
  const { data: objs } = await supabase.from("objects").select("id, x, y, width, height").eq("board_id", boardId).in("id", rawIds);
  if (!objs || objs.length < 2) return { error: "Could not fetch enough objects to arrange." };
  const op: string = args.operation; const gap: number = args.gap ?? 20; const columns: number = args.columns ?? Math.ceil(Math.sqrt(objs.length));
  const now = new Date().toISOString();
  const patches: Array<{ id: string; x?: number; y?: number }> = [];
  switch (op) {
    case "align-left": { const a = Math.min(...objs.map((o: any) => o.x)); for (const o of objs) patches.push({ id: o.id, x: a }); break; }
    case "align-right": { const a = Math.max(...objs.map((o: any) => o.x + o.width)); for (const o of objs) patches.push({ id: o.id, x: a - o.width }); break; }
    case "align-center-x": { const a = objs.reduce((s: number, o: any) => s + o.x + o.width / 2, 0) / objs.length; for (const o of objs) patches.push({ id: o.id, x: Math.round(a - o.width / 2) }); break; }
    case "align-top": { const a = Math.min(...objs.map((o: any) => o.y)); for (const o of objs) patches.push({ id: o.id, y: a }); break; }
    case "align-bottom": { const a = Math.max(...objs.map((o: any) => o.y + o.height)); for (const o of objs) patches.push({ id: o.id, y: a - o.height }); break; }
    case "align-center-y": { const a = objs.reduce((s: number, o: any) => s + o.y + o.height / 2, 0) / objs.length; for (const o of objs) patches.push({ id: o.id, y: Math.round(a - o.height / 2) }); break; }
    case "distribute-horizontal": { const sorted = [...objs].sort((a: any, b: any) => a.x - b.x); const totalW = sorted.reduce((s: number, o: any) => s + o.width, 0); const span = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width - sorted[0].x; const spacing = Math.max((span - totalW) / (sorted.length - 1), gap); let curX = sorted[0].x; for (const o of sorted) { patches.push({ id: o.id, x: Math.round(curX) }); curX += o.width + spacing; } break; }
    case "distribute-vertical": { const sorted = [...objs].sort((a: any, b: any) => a.y - b.y); const totalH = sorted.reduce((s: number, o: any) => s + o.height, 0); const span = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height - sorted[0].y; const spacing = Math.max((span - totalH) / (sorted.length - 1), gap); let curY = sorted[0].y; for (const o of sorted) { patches.push({ id: o.id, y: Math.round(curY) }); curY += o.height + spacing; } break; }
    case "grid": { const sx = Math.min(...objs.map((o: any) => o.x)); const sy = Math.min(...objs.map((o: any) => o.y)); const cW = Math.max(...objs.map((o: any) => o.width)) + gap; const cH = Math.max(...objs.map((o: any) => o.height)) + gap; objs.forEach((o: any, i: number) => { patches.push({ id: o.id, x: sx + (i % columns) * cW, y: sy + Math.floor(i / columns) * cH }); }); break; }
    default: return { error: `Unknown operation "${op}".` };
  }
  await applyObjectPatches(supabase, boardId, patches, now);
  return { arranged: patches.length, message: `Applied ${op} to ${patches.length} object(s).` };
}

async function executeDuplicateObjects(args: Record<string, any>, boardId: string, userId: string, context: ToolContext) {
  const supabase = getSupabaseAdmin();
  const rawIds: string[] = args.ids?.length ? args.ids : context.selectedIds ?? [];
  if (rawIds.length === 0) return { error: "No object IDs provided and nothing is selected." };
  const offsetX: number = args.offsetX ?? 20; const offsetY: number = args.offsetY ?? 20;
  const { data: objs } = await supabase.from("objects").select("*").eq("board_id", boardId).in("id", rawIds);
  if (!objs || objs.length === 0) return { error: "No matching objects found." };
  const baseZIndex = Date.now(); const now = new Date().toISOString();
  const idMap: Record<string, string> = {};
  const newRows = objs.map((o: any, i: number) => { const newId = generateUUID(); idMap[o.id] = newId; return { id: newId, board_id: boardId, type: o.type, x: o.x + offsetX, y: o.y + offsetY, width: o.width, height: o.height, color: o.color, text: o.text ?? "", text_size: o.text_size, text_color: o.text_color, text_vertical_align: o.text_vertical_align, rotation: o.rotation, z_index: baseZIndex + i, created_by: userId, parent_frame_id: o.parent_frame_id, points: o.points, stroke_width: o.stroke_width, created_at: now, updated_at: now }; });
  const { error: insErr } = await supabase.from("objects").insert(newRows);
  if (insErr) return { error: insErr.message };
  const { data: conns } = await supabase.from("connectors").select("*").eq("board_id", boardId).in("from_id", rawIds).in("to_id", rawIds);
  if (conns && conns.length > 0) {
    const newConns = conns.map((c: any) => ({ board_id: boardId, from_id: idMap[c.from_id] ?? c.from_id, to_id: idMap[c.to_id] ?? c.to_id, style: c.style, from_point: c.from_point, to_point: c.to_point, color: c.color, stroke_width: c.stroke_width }));
    await supabase.from("connectors").insert(newConns);
  }
  return { created: newRows.length, ids: Object.values(idMap), idMap, message: `Duplicated ${newRows.length} object(s).` };
}

async function executeSearchObjects(args: Record<string, any>, boardId: string) {
  const supabase = getSupabaseAdmin();
  const { text: searchText, type: searchType, color: searchColor, parentFrameId: searchParent } = args;
  const searchLimit: number = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 500) : 100;
  if (!searchText && !searchType && !searchColor && !searchParent) return { error: "Provide at least one of: text, type, color, parentFrameId." };
  let query = supabase.from("objects").select("id, type, x, y, width, height, color, text, parent_frame_id").eq("board_id", boardId);
  if (searchType) query = query.eq("type", searchType);
  if (searchText) query = query.ilike("text", `%${searchText}%`);
  if (searchParent) query = query.eq("parent_frame_id", searchParent);
  if (searchColor) { const hex = resolveColor(searchColor) ?? searchColor; query = query.ilike("color", hex); }
  const { data: results, error } = await query.limit(searchLimit);
  if (error) return { error: error.message };
  if (!results || results.length === 0) return { found: 0, objects: [], message: "No matching objects found." };
  return { found: results.length, objects: results.map((o: any) => ({ id: o.id, type: o.type, text: o.text, color: colorLabel(o.color) !== o.color ? `${o.color} (${colorLabel(o.color)})` : o.color, x: o.x, y: o.y, parentFrameId: o.parent_frame_id })), message: `Found ${results.length} matching object(s).` };
}

async function executeGetBoardContext(args: Record<string, any>, boardId: string, context: ToolContext) {
  const scope: string = args.scope || "board_summary";
  const limit: number = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.min(Math.max(1, Math.floor(args.limit)), 500) : 120;
  const types: string[] | undefined = Array.isArray(args.types) ? args.types.filter((t: unknown) => typeof t === "string") : undefined;
  if (scope === "board_summary") { const summary = await fetchBoardSummary(boardId); return { scope, ...summary }; }
  if (scope === "selected") { const ids = Array.isArray(context.selectedIds) ? context.selectedIds : []; if (ids.length === 0) return { scope, found: 0, objects: [], message: "No selected objects." }; const objects = await fetchObjectsByIds(boardId, ids, types); return { scope, requested: ids.length, found: objects.length, objects, message: `Loaded ${objects.length} selected object(s).` }; }
  if (scope === "ids") { const ids: string[] = Array.isArray(args.ids) ? args.ids.filter((id: unknown) => typeof id === "string") : []; if (ids.length === 0) return { error: "scope='ids' requires a non-empty ids array." }; const objects = await fetchObjectsByIds(boardId, ids, types); return { scope, requested: ids.length, found: objects.length, objects, message: `Loaded ${objects.length} object(s) by ID.` }; }
  if (scope === "viewport") { const bbox = args.bbox; if (!bbox || typeof bbox !== "object") return { error: "scope='viewport' requires bbox with x1,y1,x2,y2." }; const x1 = Number(bbox.x1), y1 = Number(bbox.y1), x2 = Number(bbox.x2), y2 = Number(bbox.y2); if (![x1, y1, x2, y2].every(Number.isFinite)) return { error: "bbox values must be finite numbers." }; const objects = await fetchObjectsInBbox(boardId, { x1, y1, x2, y2 }, { types, limit }); return { scope, bbox: { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) }, found: objects.length, objects, message: `Loaded ${objects.length} viewport object(s).` }; }
  if (scope === "frame") { const frameId: string | undefined = typeof args.frameId === "string" ? args.frameId : undefined; if (!frameId) return { error: "scope='frame' requires frameId." }; const fc = await fetchFrameWithChildren(boardId, frameId, { types, limit }); if (!fc) return { error: `Frame not found: ${frameId}` }; return { scope, frame: fc.frame, childCount: fc.children.length, children: fc.children, message: `Loaded frame and ${fc.children.length} child object(s).` }; }
  return { error: "Invalid scope. Supported scopes: board_summary, selected, viewport, frame, ids." };
}

async function executeCreateWireframe(args: Record<string, any>, boardId: string, userId: string, context: ToolContext) {
  const supabase = getSupabaseAdmin();
  const { title, sections, deviceType = "desktop" } = args;
  if (!Array.isArray(sections) || sections.length === 0) return { error: "sections array is required and cannot be empty" };
  const frameWidth = args.width ?? (deviceType === "mobile" ? 375 : deviceType === "tablet" ? 768 : 800);
  const rowUnit = 60, sectionGap = 4, sectionPad = 8;
  let totalHeight = sectionPad;
  for (const section of sections) totalHeight += (section.heightRatio ?? 1) * rowUnit + sectionGap;
  totalHeight += sectionPad;
  const defaultX = context.viewportCenter?.x ? context.viewportCenter.x - Math.round(frameWidth / 2) : 100;
  const defaultY = context.viewportCenter?.y ? context.viewportCenter.y - Math.round(totalHeight / 2) : 100;
  const pos = await findOpenCanvasSpace(boardId, frameWidth + 40, totalHeight + 80, args.startX ?? defaultX, args.startY ?? defaultY);
  const now = new Date().toISOString(); let zIndex = Date.now();
  const { data: frameData, error: frameErr } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: pos.x, y: pos.y, width: frameWidth + 40, height: totalHeight + 80, color: "#F9F9F7", text: title || "Wireframe", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
  if (frameErr || !frameData) return { error: frameErr?.message || "Failed to create wireframe frame" };
  const frameId = frameData.id;
  const children: any[] = [];
  let curY = pos.y + 60;
  for (const section of sections) {
    const ratio = section.heightRatio ?? 1, sectionHeight = ratio * rowUnit, split: string = section.split ?? "full";
    if (split === "full") { children.push({ board_id: boardId, type: "rectangle", x: pos.x + sectionPad + 20, y: curY, width: frameWidth - sectionPad * 2, height: sectionHeight, color: "#E5E5E0", text: section.label || "", parent_frame_id: frameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }); }
    else {
      const splits = split === "two-column" ? [0.5, 0.5] : split === "three-column" ? [0.333, 0.334, 0.333] : split === "left-sidebar" ? [0.25, 0.75] : [0.75, 0.25];
      const labels: string[] = section.splitLabels ?? [];
      let curX = pos.x + sectionPad + 20; const availW = frameWidth - sectionPad * 2;
      splits.forEach((frac: number, i: number) => { const w = Math.round(availW * frac - (i < splits.length - 1 ? sectionGap : 0)); children.push({ board_id: boardId, type: "rectangle", x: Math.round(curX), y: curY, width: w, height: sectionHeight, color: "#E5E5E0", text: labels[i] ?? section.label ?? "", parent_frame_id: frameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }); curX += w + sectionGap; });
    }
    curY += sectionHeight + sectionGap;
  }
  if (children.length > 0) { const { error: childErr } = await supabase.from("objects").insert(children); if (childErr) return { error: childErr.message }; }
  const allCreated = [{ x: pos.x, y: pos.y, width: frameWidth + 40, height: totalHeight + 80 }, ...children.map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height }))];
  const _viewport = computeNavigationViewport(allCreated, context.screenSize);
  return { created: 1 + children.length, frameId, message: `Created wireframe "${title}" with ${children.length} sections.`, ...(_viewport ? { _viewport } : {}) };
}

async function executeCreateMindMap(args: Record<string, any>, boardId: string, userId: string, context: ToolContext, _openaiApiKey?: string) {
  const supabase = getSupabaseAdmin();
  const { centerTopic, branches, sourceIds: mmSourceIds } = args;
  const innerRadius = 250, outerRadius = 450;
  const branchColors = ["#7FC8E8", "#9DD9A3", "#FAD84E", "#F5A8C4", "#E5E5E0"];
  const cx = args.startX ?? context.viewportCenter?.x ?? 500;
  const cy = args.startY ?? context.viewportCenter?.y ?? 400;

  // ── Reposition mode ──
  if (Array.isArray(mmSourceIds) && mmSourceIds.length > 0 && Array.isArray(branches) && branches.length > 0) {
    const allObjIds = mmSourceIds.flatMap((s: any) => s.objectIds || []);
    const { data: srcObjs } = await supabase.from("objects").select("id, x, y, width, height").eq("board_id", boardId).in("id", allObjIds);
    if (!srcObjs || srcObjs.length === 0) return { error: "None of the sourceIds objects were found on this board." };
    const objMap = new Map(srcObjs.map((o: any) => [o.id, o]));
    const sourceMap = new Map(mmSourceIds.map((s: any) => [s.branchLabel, s.objectIds || []]));
    const now = new Date().toISOString(); let zIndex = Date.now();
    const centerW = 200, centerH = 80, branchW = 160, branchH = 60;
    const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
    const allPositions: Array<{ x: number; y: number; width: number; height: number }> = [];
    const connectorRows: any[] = []; let totalCreated = 0;
    const { data: centerData, error: centerErr } = await supabase.from("objects").insert({ board_id: boardId, type: "rectangle", x: cx - centerW / 2, y: cy - centerH / 2, width: centerW, height: centerH, color: "#3B82F6", text: centerTopic || "Central Topic", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
    if (centerErr || !centerData) return { error: centerErr?.message || "Failed to create center node" };
    const centerId = centerData.id; totalCreated++; allPositions.push({ x: cx - centerW / 2, y: cy - centerH / 2, width: centerW, height: centerH });
    const n = branches.length;
    for (let i = 0; i < n; i++) {
      const branch = branches[i]; const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const bx = cx + Math.round(innerRadius * Math.cos(angle)) - branchW / 2;
      const by = cy + Math.round(innerRadius * Math.sin(angle)) - branchH / 2;
      const color = (branch.color ? resolveColor(branch.color) : null) || branchColors[i % branchColors.length];
      const { data: bData, error: bErr } = await supabase.from("objects").insert({ board_id: boardId, type: "sticky", x: bx, y: by, width: branchW, height: branchH, color, text: branch.label || "", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
      if (bErr || !bData) continue; totalCreated++; allPositions.push({ x: bx, y: by, width: branchW, height: branchH });
      connectorRows.push({ board_id: boardId, from_id: centerId, to_id: bData.id, style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
      const idsForBranch: string[] = sourceMap.get(branch.label) || [];
      if (idsForBranch.length > 0) {
        const subAngleSpread = (2 * Math.PI / Math.max(n, 2)) * 0.6;
        let currentLayerRadius = outerRadius; let remainingIds = [...idsForBranch]; const layers: string[][] = [];
        while (remainingIds.length > 0) { const maxItems = Math.max(1, Math.floor(currentLayerRadius * subAngleSpread / 180) + 1); layers.push(remainingIds.slice(0, maxItems)); remainingIds = remainingIds.slice(maxItems); currentLayerRadius += 220; }
        for (let l = 0; l < layers.length; l++) {
          const layerIds = layers[l]; const layerRadius = outerRadius + l * 220;
          const spread = Math.min(subAngleSpread, (layerIds.length * 180) / layerRadius);
          for (let k = 0; k < layerIds.length; k++) {
            const objId = layerIds[k]; const obj = objMap.get(objId); if (!obj) continue;
            const subAngleOffset = layerIds.length > 1 ? (k - (layerIds.length - 1) / 2) * (spread / (layerIds.length - 1)) : 0;
            const subAngle = angle + subAngleOffset;
            const sx = cx + Math.round(layerRadius * Math.cos(subAngle)) - Math.round((obj.width || 150) / 2);
            const sy = cy + Math.round(layerRadius * Math.sin(subAngle)) - Math.round((obj.height || 150) / 2);
            patches.push({ id: objId, x: sx, y: sy, parentFrameId: null }); allPositions.push({ x: sx, y: sy, width: obj.width || 150, height: obj.height || 150 });
            connectorRows.push({ board_id: boardId, from_id: bData.id, to_id: objId, style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
          }
        }
      }
    }
    const moved = await repositionObjects(supabase, boardId, patches);
    if (connectorRows.length > 0) await supabase.from("connectors").insert(connectorRows);
    const _viewport = computeNavigationViewport(allPositions, context.screenSize);
    return { created: totalCreated, repositioned: moved, connectors: connectorRows.length, centerId, message: `Created mind map with ${totalCreated} new nodes. Repositioned ${moved} existing objects into branches with ${connectorRows.length} connectors.`, ...(_viewport ? { _viewport } : {}) };
  }

  // ── Normal create mode ──
  if (!Array.isArray(branches) || branches.length === 0) return { error: "branches array is required and cannot be empty" };
  const now = new Date().toISOString(); let zIndex = Date.now();
  const centerW = 200, centerH = 80, branchW = 160, branchH = 60, subW = 140, subH = 50;
  const { data: centerData, error: centerErr } = await supabase.from("objects").insert({ board_id: boardId, type: "rectangle", x: cx - centerW / 2, y: cy - centerH / 2, width: centerW, height: centerH, color: "#3B82F6", text: centerTopic || "Central Topic", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
  if (centerErr || !centerData) return { error: centerErr?.message || "Failed to create center node" };
  const centerId = centerData.id; let totalCreated = 1;
  const connectorRows: any[] = [];
  const allPositions: Array<{ x: number; y: number; width: number; height: number }> = [{ x: cx - centerW / 2, y: cy - centerH / 2, width: centerW, height: centerH }];
  const n = branches.length;
  for (let i = 0; i < n; i++) {
    const branch = branches[i]; const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const bx = cx + Math.round(innerRadius * Math.cos(angle)) - branchW / 2;
    const by = cy + Math.round(innerRadius * Math.sin(angle)) - branchH / 2;
    const color = (branch.color ? resolveColor(branch.color) : null) || branchColors[i % branchColors.length];
    const { data: bData, error: bErr } = await supabase.from("objects").insert({ board_id: boardId, type: "sticky", x: bx, y: by, width: branchW, height: branchH, color, text: branch.label || "", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
    if (bErr || !bData) continue; totalCreated++; allPositions.push({ x: bx, y: by, width: branchW, height: branchH });
    connectorRows.push({ board_id: boardId, from_id: centerId, to_id: bData.id, style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
    const children: string[] = Array.isArray(branch.children) ? branch.children : [];
    if (children.length > 0) {
      const subAngleSpread = (2 * Math.PI / Math.max(n, 2)) * 0.6;
      let currentLayerRadius = outerRadius; let remainingTexts = [...children]; const layers: string[][] = [];
      while (remainingTexts.length > 0) { const maxItems = Math.max(1, Math.floor(currentLayerRadius * subAngleSpread / 180) + 1); layers.push(remainingTexts.slice(0, maxItems)); remainingTexts = remainingTexts.slice(maxItems); currentLayerRadius += 220; }
      for (let l = 0; l < layers.length; l++) {
        const layerTexts = layers[l]; const layerRadius = outerRadius + l * 220;
        const spread = Math.min(subAngleSpread, (layerTexts.length * 180) / layerRadius);
        for (let k = 0; k < layerTexts.length; k++) {
          const subAngleOffset = layerTexts.length > 1 ? (k - (layerTexts.length - 1) / 2) * (spread / (layerTexts.length - 1)) : 0;
          const subAngle = angle + subAngleOffset;
          const sx = cx + Math.round(layerRadius * Math.cos(subAngle)) - subW / 2;
          const sy = cy + Math.round(layerRadius * Math.sin(subAngle)) - subH / 2;
          const { data: sData, error: sErr } = await supabase.from("objects").insert({ board_id: boardId, type: "sticky", x: sx, y: sy, width: subW, height: subH, color, text: layerTexts[k] || "", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
          if (sErr || !sData) continue; totalCreated++; allPositions.push({ x: sx, y: sy, width: subW, height: subH });
          connectorRows.push({ board_id: boardId, from_id: bData.id, to_id: sData.id, style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
        }
      }
    }
  }
  if (connectorRows.length > 0) await supabase.from("connectors").insert(connectorRows);
  const _viewport = computeNavigationViewport(allPositions, context.screenSize);
  return { created: totalCreated, connectors: connectorRows.length, centerId, message: `Created mind map with ${totalCreated} nodes and ${connectorRows.length} connectors.`, ...(_viewport ? { _viewport } : {}) };
}

async function executeCreateFlowchart(args: Record<string, any>, boardId: string, userId: string, context: ToolContext) {
  const supabase = getSupabaseAdmin();
  const { title, steps, direction = "top-to-bottom", sourceIds: fcSourceIds } = args;
  const isVertical = direction === "top-to-bottom";

  // Reposition mode
  if (Array.isArray(fcSourceIds) && fcSourceIds.length > 0) {
    const allObjIds = fcSourceIds.flatMap((s: any) => s.objectIds || []);
    const { data: srcObjs } = await supabase.from("objects").select("id, x, y, width, height").eq("board_id", boardId).in("id", allObjIds);
    if (!srcObjs || srcObjs.length === 0) return { error: "None of the sourceIds objects were found on this board." };
    const objMap = new Map(srcObjs.map((o: any) => [o.id, o]));
    const stepGapR = 80;
    let cursorX = args.startX ?? context.viewportCenter?.x ?? 200;
    let cursorY = args.startY ?? context.viewportCenter?.y ?? 200;
    const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
    const allPositions: Array<{ x: number; y: number; width: number; height: number }> = [];
    const connectorRows: any[] = []; let prevId: string | null = null;
    for (let i = 0; i < fcSourceIds.length; i++) {
      const ids: string[] = fcSourceIds[i].objectIds || []; const firstId = ids[0]; const obj = firstId ? objMap.get(firstId) : null; if (!obj) continue;
      const w = obj.width || 200, h = obj.height || 80;
      patches.push({ id: obj.id, x: cursorX, y: cursorY, parentFrameId: null }); allPositions.push({ x: cursorX, y: cursorY, width: w, height: h });
      if (prevId) connectorRows.push({ board_id: boardId, from_id: prevId, to_id: obj.id, style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
      prevId = obj.id; if (isVertical) cursorY += h + stepGapR; else cursorX += w + stepGapR;
    }
    const moved = await repositionObjects(supabase, boardId, patches);
    if (connectorRows.length > 0) await supabase.from("connectors").insert(connectorRows);
    const _viewport = computeNavigationViewport(allPositions, context.screenSize);
    return { repositioned: moved, connectors: connectorRows.length, message: `Reorganized ${moved} objects into a ${direction} flowchart with ${connectorRows.length} connectors.`, ...(_viewport ? { _viewport } : {}) };
  }

  // Normal create mode
  if (!Array.isArray(steps) || steps.length === 0) return { error: "steps array is required and cannot be empty" };
  const now = new Date().toISOString(); let zIndex = Date.now();
  const stepGap = 80, processW = 200, processH = 80, decisionSize = 100, startEndW = 150, startEndH = 50;
  const getStepDims = (type: string) => { switch (type) { case "decision": return { w: decisionSize, h: decisionSize }; case "start": case "end": return { w: startEndW, h: startEndH }; default: return { w: processW, h: processH }; } };
  const totalSteps = steps.length; const maxW = Math.max(processW, decisionSize, startEndW); const maxH = Math.max(processH, decisionSize, startEndH);
  const totalSpan = totalSteps * (isVertical ? maxH : maxW) + (totalSteps - 1) * stepGap;
  const frameW = isVertical ? maxW + 200 : totalSpan + 200; const frameH = isVertical ? totalSpan + 160 : maxH + 250;
  const defaultX = context.viewportCenter?.x ? context.viewportCenter.x - Math.round(frameW / 2) : 100;
  const defaultY = context.viewportCenter?.y ? context.viewportCenter.y - Math.round(frameH / 2) : 100;
  const pos = await findOpenCanvasSpace(boardId, frameW, frameH, args.startX ?? defaultX, args.startY ?? defaultY);
  const { data: frameData, error: frameErr } = await supabase.from("objects").insert({ board_id: boardId, type: "frame", x: pos.x, y: pos.y, width: frameW, height: frameH, color: "#F9F9F7", text: title || "Flowchart", rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
  if (frameErr || !frameData) return { error: frameErr?.message || "Failed to create flowchart frame" };
  const frameId = frameData.id;
  const stepIds: string[] = []; const stepPositions: Array<{ x: number; y: number; width: number; height: number }> = []; let totalCreated = 1;
  const contentStartX = pos.x + Math.round(frameW / 2); const contentStartY = pos.y + 80;
  for (let i = 0; i < totalSteps; i++) {
    const step = steps[i]; const stepType: string = step.type || "process"; const dims = getStepDims(stepType);
    const color = stepType === "decision" ? "#FAD84E" : stepType === "start" || stepType === "end" ? "#9DD9A3" : "#E5E5E0";
    const shapeType = stepType === "decision" ? "circle" : "rectangle";
    const sx = isVertical ? contentStartX - Math.round(dims.w / 2) : contentStartX - Math.round(frameW / 2) + 100 + i * (maxW + stepGap);
    const sy = isVertical ? contentStartY + i * (maxH + stepGap) : contentStartY + Math.round((frameH - 160) / 2) - Math.round(dims.h / 2);
    const { data: sData, error: sErr } = await supabase.from("objects").insert({ board_id: boardId, type: shapeType, x: sx, y: sy, width: dims.w, height: dims.h, color, text: step.label || `Step ${i + 1}`, parent_frame_id: frameId, rotation: 0, z_index: zIndex++, created_by: userId, created_at: now, updated_at: now }).select("id").single();
    if (sErr || !sData) { stepIds.push(""); stepPositions.push({ x: sx, y: sy, width: dims.w, height: dims.h }); continue; }
    stepIds.push(sData.id); stepPositions.push({ x: sx, y: sy, width: dims.w, height: dims.h }); totalCreated++;
  }
  const connectorRows: any[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const step = steps[i]; const fromId = stepIds[i]; if (!fromId) continue;
    if (Array.isArray(step.branches) && step.branches.length > 0) {
      for (const branch of step.branches) { const targetIdx = branch.targetStepIndex; if (typeof targetIdx === "number" && targetIdx >= 0 && targetIdx < totalSteps && stepIds[targetIdx]) connectorRows.push({ board_id: boardId, from_id: fromId, to_id: stepIds[targetIdx], style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null }); }
      if (i + 1 < totalSteps && stepIds[i + 1]) connectorRows.push({ board_id: boardId, from_id: fromId, to_id: stepIds[i + 1], style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
    } else if (i + 1 < totalSteps && stepIds[i + 1]) connectorRows.push({ board_id: boardId, from_id: fromId, to_id: stepIds[i + 1], style: "arrow", color: null, stroke_width: null, from_point: null, to_point: null });
  }
  if (connectorRows.length > 0) await supabase.from("connectors").insert(connectorRows);
  const allBounds = [{ x: pos.x, y: pos.y, width: frameW, height: frameH }, ...stepPositions];
  const _viewport = computeNavigationViewport(allBounds, context.screenSize);
  return { created: totalCreated, connectors: connectorRows.length, frameId, stepIds: stepIds.filter(Boolean), message: `Created flowchart "${title}" with ${totalCreated} objects and ${connectorRows.length} connectors.`, ...(_viewport ? { _viewport } : {}) };
}

// ─── Board State Queries (used by tools + exported for route handlers) ──

export async function fetchBoardSummary(boardId: string) {
  const supabase = getSupabaseAdmin();
  const [objRes, connRes] = await Promise.all([supabase.from("objects").select("id, type, x, y, width, height, text, parent_frame_id").eq("board_id", boardId), supabase.from("connectors").select("id").eq("board_id", boardId)]);
  const objects = objRes.data || []; const typeCounts: Record<string, number> = {}; const childCounts: Record<string, number> = {};
  for (const obj of objects) { const type = typeof obj.type === "string" ? obj.type : "unknown"; typeCounts[type] = (typeCounts[type] ?? 0) + 1; if (obj.parent_frame_id) childCounts[obj.parent_frame_id] = (childCounts[obj.parent_frame_id] ?? 0) + 1; }
  const frames = objects.filter((o: any) => o.type === "frame").slice(0, 120).map((frame: any) => ({ id: frame.id, text: frame.text || "", x: frame.x, y: frame.y, width: frame.width, height: frame.height, childCount: childCounts[frame.id] ?? 0 }));
  return { objectCount: objects.length, connectorCount: (connRes.data || []).length, typeCounts, frames };
}

export async function fetchObjectsByIds(boardId: string, ids: string[], types?: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const supabase = getSupabaseAdmin();
  let query = supabase.from("objects").select("*").eq("board_id", boardId).in("id", ids);
  if (types && types.length > 0) query = query.in("type", types);
  const { data } = await query; return (data || []).map(annotateObjectRow);
}

export async function fetchObjectsInBbox(boardId: string, bbox: { x1: number; y1: number; x2: number; y2: number }, options: { types?: string[]; limit?: number } = {}) {
  const supabase = getSupabaseAdmin();
  const minX = Math.min(bbox.x1, bbox.x2), maxX = Math.max(bbox.x1, bbox.x2), minY = Math.min(bbox.y1, bbox.y2), maxY = Math.max(bbox.y1, bbox.y2);
  const ORIGIN_PADDING = 1200;
  let query = supabase.from("objects").select("*").eq("board_id", boardId).gte("x", minX - ORIGIN_PADDING).lte("x", maxX).gte("y", minY - ORIGIN_PADDING).lte("y", maxY);
  if (options.types && options.types.length > 0) query = query.in("type", options.types);
  const limit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.min(Math.max(1, Math.floor(options.limit)), 500) : 120;
  const { data } = await query.limit(limit);
  return (data || []).filter((row: any) => { const right = (row.x ?? 0) + (row.width ?? 0), bottom = (row.y ?? 0) + (row.height ?? 0); return right >= minX && bottom >= minY; }).map(annotateObjectRow);
}

export async function fetchFrameWithChildren(boardId: string, frameId: string, options: { types?: string[]; limit?: number } = {}) {
  const supabase = getSupabaseAdmin();
  const effectiveLimit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.min(Math.max(1, Math.floor(options.limit)), 500) : 120;
  let childrenQuery = supabase.from("objects").select("*").eq("board_id", boardId).eq("parent_frame_id", frameId);
  if (options.types && options.types.length > 0) childrenQuery = childrenQuery.in("type", options.types);
  const [frameRes, childrenRes] = await Promise.all([supabase.from("objects").select("*").eq("board_id", boardId).eq("id", frameId).maybeSingle(), childrenQuery.limit(effectiveLimit)]);
  if (!frameRes.data) return null;
  return { frame: annotateObjectRow(frameRes.data), children: (childrenRes.data || []).map(annotateObjectRow) };
}

export async function fetchBoardState(boardId: string) {
  const supabase = getSupabaseAdmin();
  const [objRes, connRes] = await Promise.all([supabase.from("objects").select("*").eq("board_id", boardId), supabase.from("connectors").select("*").eq("board_id", boardId)]);
  const objects = (objRes.data || []).map(annotateObjectRow); const connectors = (connRes.data || []).map(annotateConnectorRow);
  return { objectCount: objects.length, connectorCount: connectors.length, objects, connectors };
}
