/**
 * Plan → Validate → Execute pipeline for complex AI operations.
 *
 * The planner makes ONE tool-free LLM call that outputs a structured JSON plan.
 * The validator checks budgets, destructive flags, and invariants.
 * The executor runs the plan deterministically using existing tools.
 *
 * This replaces the fragile multi-iteration tool-calling loop for
 * reorganize/restructure commands.
 */

import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabaseAdmin";
import * as tools from "./tools";
import { buildBoardDigest } from "./digest";
import type { CompactObject, Viewport } from "../boardState";
import type { ToolContext } from "./tools";

// ─── Plan Schema ──────────────────────────────────────────────

export interface Plan {
  /** What the plan does */
  summary: string;
  /** Frames to create (executor fills in IDs) */
  newFrames: PlanFrame[];
  /** Existing objects to move into frames */
  assignments: PlanAssignment[];
  /** Objects to delete */
  deleteIds: string[];
  /** New stickies to create (free or inside frames) */
  newStickies: PlanSticky[];
  /** Frames to rearrange after mutations */
  rearrangeFrameKeys: string[];
}

interface PlanFrame {
  /** Symbolic key for referencing in assignments (e.g., "frame_0") */
  key: string;
  title: string;
  color: string;
}

interface PlanAssignment {
  objectId: string;
  /** Key of a new frame, OR id of an existing frame */
  targetFrameKey: string;
}

interface PlanSticky {
  text: string;
  color: string;
  /** Key of a new frame, OR id of an existing frame, OR null for free */
  targetFrameKey: string | null;
}

// ─── Validation ───────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

const MAX_PLAN_CREATES = 100;
const MAX_PLAN_DELETES = 200;
const MAX_PLAN_MOVES = 200;

export function validatePlan(plan: Plan, objectCount: number): ValidationResult {
  const warnings: string[] = [];

  // Budget checks
  const totalCreates = plan.newFrames.length + plan.newStickies.length;
  if (totalCreates > MAX_PLAN_CREATES) {
    return { ok: false, error: `Plan creates ${totalCreates} objects (max ${MAX_PLAN_CREATES})`, warnings };
  }
  if (plan.deleteIds.length > MAX_PLAN_DELETES) {
    return { ok: false, error: `Plan deletes ${plan.deleteIds.length} objects (max ${MAX_PLAN_DELETES})`, warnings };
  }
  if (plan.assignments.length > MAX_PLAN_MOVES) {
    return { ok: false, error: `Plan moves ${plan.assignments.length} objects (max ${MAX_PLAN_MOVES})`, warnings };
  }

  // Warn on destructive operations
  if (plan.deleteIds.length > 0) {
    warnings.push(`Plan will delete ${plan.deleteIds.length} object(s)`);
  }
  if (plan.deleteIds.length > objectCount * 0.5) {
    warnings.push("Plan deletes more than half the board");
  }

  // Check for duplicate frame keys
  const keys = new Set<string>();
  for (const f of plan.newFrames) {
    if (keys.has(f.key)) {
      return { ok: false, error: `Duplicate frame key: ${f.key}`, warnings };
    }
    keys.add(f.key);
  }

  return { ok: true, warnings };
}

// ─── Plan Generation (single LLM call, no tools) ─────────────

const PLANNER_SYSTEM = `You are a whiteboard layout planner. Given a user command and the current board state, output a structured JSON plan.

You MUST return valid JSON with this exact schema:
{
  "summary": "Brief description of what the plan does",
  "newFrames": [{"key": "frame_0", "title": "Category Name", "color": "#hex"}],
  "assignments": [{"objectId": "existing-uuid", "targetFrameKey": "frame_0"}],
  "deleteIds": ["uuid-to-delete"],
  "newStickies": [{"text": "content", "color": "#hex", "targetFrameKey": "frame_0"}],
  "rearrangeFrameKeys": ["frame_0"]
}

Rules:
- "key" in newFrames is a symbolic reference (e.g., "frame_0", "frame_1"). Use these in assignments/stickies.
- "targetFrameKey" can reference a new frame key OR an existing frame's UUID.
- For reorganization: group existing objects by theme, create frames, assign objects.
- For cleanup: rearrange existing frames (use rearrangeFrameKeys with existing frame IDs).
- Minimize deletions. Move objects rather than delete+recreate.
- Colors: #FBBF24 yellow, #F472B6 pink, #3B82F6 blue, #22C55E green, #F97316 orange, #A855F7 purple, #EF4444 red, #9CA3AF gray
- Frame color is always "#F3F4F6". Use color on stickies only.
- Keep it simple. Fewer operations is better.`;

export async function generatePlan(
  command: string,
  boardObjects: CompactObject[],
  viewport: Viewport,
  selectedIds: string[],
  openaiApiKey: string
): Promise<Plan> {
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const digest = buildBoardDigest(boardObjects, {
    selectedIds,
    viewport,
    scope: selectedIds.length > 0 ? "selected" : "board",
    includeFullObjects: true,
    maxDetailObjects: 80,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: `Command: ${command}\n\nBoard state:\n${digest}` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2000,
    temperature: 0.3,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  // Normalize and validate structure
  return {
    summary: String(parsed.summary ?? ""),
    newFrames: Array.isArray(parsed.newFrames)
      ? parsed.newFrames.map((f: any) => ({
          key: String(f.key ?? ""),
          title: String(f.title ?? "Untitled"),
          color: String(f.color ?? "#F3F4F6"),
        }))
      : [],
    assignments: Array.isArray(parsed.assignments)
      ? parsed.assignments.map((a: any) => ({
          objectId: String(a.objectId ?? ""),
          targetFrameKey: String(a.targetFrameKey ?? ""),
        }))
      : [],
    deleteIds: Array.isArray(parsed.deleteIds)
      ? parsed.deleteIds.map(String)
      : [],
    newStickies: Array.isArray(parsed.newStickies)
      ? parsed.newStickies.map((s: any) => ({
          text: String(s.text ?? ""),
          color: String(s.color ?? "#FBBF24"),
          targetFrameKey: s.targetFrameKey ? String(s.targetFrameKey) : null,
        }))
      : [],
    rearrangeFrameKeys: Array.isArray(parsed.rearrangeFrameKeys)
      ? parsed.rearrangeFrameKeys.map(String)
      : [],
  };
}

// ─── Plan Execution (deterministic, no LLM) ──────────────────

export interface PlanExecutionResult {
  success: boolean;
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  error?: string;
  /** Steps completed for progress tracking */
  stepsCompleted: number;
  stepsTotal: number;
}

export async function executePlan(
  plan: Plan,
  ctx: ToolContext,
  viewport: Viewport,
  onProgress?: (step: number, total: number, label: string) => void
): Promise<PlanExecutionResult> {
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const deletedIds: string[] = [];
  const frameKeyToId: Record<string, string> = {};

  const stepsTotal =
    (plan.deleteIds.length > 0 ? 1 : 0) +
    plan.newFrames.length +
    (plan.assignments.length > 0 ? 1 : 0) +
    (plan.newStickies.length > 0 ? 1 : 0) +
    plan.rearrangeFrameKeys.length;
  let step = 0;

  const progress = (label: string) => {
    step++;
    onProgress?.(step, stepsTotal, label);
  };

  try {
    // ── Step 1: Delete objects ──
    if (plan.deleteIds.length > 0) {
      progress("Deleting objects");
      const result = await tools.bulkDelete(ctx, "by_ids", plan.deleteIds);
      if (result.data?.deletedIds) {
        deletedIds.push(...result.data.deletedIds);
      }
    }

    // ── Step 2: Create new frames ──
    // Position frames in a row centered on viewport
    const supabase = getSupabaseAdmin();
    const frameCount = plan.newFrames.length;

    if (frameCount > 0) {
      const { calculateFrameSize: calcSize } = await import("../framePlacement");

      // Estimate child count per frame for sizing
      const childCounts: Record<string, number> = {};
      for (const a of plan.assignments) {
        childCounts[a.targetFrameKey] = (childCounts[a.targetFrameKey] ?? 0) + 1;
      }
      for (const s of plan.newStickies) {
        if (s.targetFrameKey) {
          childCounts[s.targetFrameKey] = (childCounts[s.targetFrameKey] ?? 0) + 1;
        }
      }

      const frameSizes = plan.newFrames.map((f) => {
        const count = childCounts[f.key] ?? 3;
        return calcSize(count, 150, 150, 3, 1);
      });

      const gap = 30;
      const totalWidth =
        frameSizes.reduce((s, f) => s + f.width, 0) + (frameCount - 1) * gap;
      let curX = viewport.centerX - totalWidth / 2;
      const baseY = viewport.centerY - (frameSizes[0]?.height ?? 300) / 2;

      for (let i = 0; i < plan.newFrames.length; i++) {
        progress(`Creating frame: ${plan.newFrames[i].title}`);

        const spec = plan.newFrames[i];
        const size = frameSizes[i];
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const obj = {
          id,
          board_id: ctx.boardId,
          type: "frame",
          x: curX,
          y: baseY,
          width: size.width,
          height: size.height,
          color: "#F3F4F6",
          text: spec.title,
          rotation: 0,
          z_index: Date.now() - 1000 + i,
          parent_frame_id: null,
          created_by: ctx.uid,
          created_at: now,
          updated_at: now,
        };

        const { error } = await supabase.from("objects").insert(obj);
        if (!error) {
          createdIds.push(id);
          frameKeyToId[spec.key] = id;
          ctx.existingObjects.push({
            id,
            type: "frame",
            x: obj.x,
            y: obj.y,
            width: obj.width,
            height: obj.height,
            color: obj.color,
            text: obj.text,
            rotation: 0,
            zIndex: obj.z_index,
            parentFrameId: null,
          });
        }

        curX += size.width + gap;
      }
    }

    // ── Step 3: Move existing objects into frames ──
    if (plan.assignments.length > 0) {
      progress("Moving objects into frames");

      for (const assign of plan.assignments) {
        // Resolve frame key → ID
        const frameId = frameKeyToId[assign.targetFrameKey] ?? assign.targetFrameKey;
        const frame = ctx.existingObjects.find((o) => o.id === frameId);
        if (!frame) continue;

        const result = await tools.addObjectToFrame(ctx, assign.objectId, frameId);
        if (result?.objectId) {
          updatedIds.push(result.objectId);
        }
      }
    }

    // ── Step 4: Create new stickies ──
    if (plan.newStickies.length > 0) {
      progress("Creating stickies");

      const items = plan.newStickies.map((s) => ({
        type: "sticky" as const,
        text: s.text,
        color: s.color,
        parentFrameId: s.targetFrameKey
          ? frameKeyToId[s.targetFrameKey] ?? s.targetFrameKey
          : undefined,
      }));

      const result = await tools.bulkCreate(ctx, items);
      if (result.data?.createdIds) {
        createdIds.push(...result.data.createdIds);
      }
    }

    // ── Step 5: Rearrange frames ──
    for (const key of plan.rearrangeFrameKeys) {
      const frameId = frameKeyToId[key] ?? key;
      progress(`Arranging frame: ${key}`);
      const result = await tools.rearrangeFrame(ctx, frameId);
      if (result.data?.updatedIds) {
        updatedIds.push(...result.data.updatedIds);
      }
    }

    return {
      success: true,
      createdIds,
      updatedIds,
      deletedIds,
      stepsCompleted: step,
      stepsTotal,
    };
  } catch (error) {
    return {
      success: false,
      createdIds,
      updatedIds,
      deletedIds,
      error: String(error),
      stepsCompleted: step,
      stepsTotal,
    };
  }
}
