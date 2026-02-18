/**
 * Deterministic template engine.
 *
 * The LLM only generates TEXT content (a tiny, fast call).
 * All layout — frame positions, sizes, sticky placement — is
 * computed deterministically using the existing frame-placement engine.
 */

import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { calculateFrameSize } from "../framePlacement.js";
import type { CompactObject, Viewport } from "../boardState.js";
import type { ToolContext } from "./tools.js";

// ─── Template Specs ───────────────────────────────────────────

interface FrameSpec {
  titleKey: string;           // key in defaults AND in content JSON
  defaultTitle: string;
  stickyColor: string;
  gridCol: number;            // column in the template grid (0-indexed)
  gridRow: number;            // row in the template grid (0-indexed)
  defaultChildCount: number;  // used for sizing + fallback content
}

interface TemplateSpec {
  id: string;
  name: string;
  columns: number;            // max columns in the frame grid
  frames: FrameSpec[];
  contentSystemPrompt: string;
  frameGap: number;
}

const TEMPLATES: Record<string, TemplateSpec> = {
  swot: {
    id: "swot",
    name: "SWOT Analysis",
    columns: 2,
    frameGap: 30,
    frames: [
      { titleKey: "strengths",     defaultTitle: "Strengths",     stickyColor: "#22C55E", gridCol: 0, gridRow: 0, defaultChildCount: 4 },
      { titleKey: "weaknesses",    defaultTitle: "Weaknesses",    stickyColor: "#EF4444", gridCol: 1, gridRow: 0, defaultChildCount: 4 },
      { titleKey: "opportunities", defaultTitle: "Opportunities", stickyColor: "#3B82F6", gridCol: 0, gridRow: 1, defaultChildCount: 4 },
      { titleKey: "threats",       defaultTitle: "Threats",       stickyColor: "#F97316", gridCol: 1, gridRow: 1, defaultChildCount: 4 },
    ],
    contentSystemPrompt: `Generate SWOT analysis content. Return JSON:
{"strengths":["...","...","...","..."],"weaknesses":["...","...","...","..."],"opportunities":["...","...","...","..."],"threats":["...","...","...","..."]}
Each point: 3-8 words. Exactly 4 per category.`,
  },

  kanban: {
    id: "kanban",
    name: "Kanban Board",
    columns: 4,
    frameGap: 30,
    frames: [
      { titleKey: "backlog",     defaultTitle: "Backlog",     stickyColor: "#9CA3AF", gridCol: 0, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "todo",        defaultTitle: "To Do",       stickyColor: "#FBBF24", gridCol: 1, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "in_progress", defaultTitle: "In Progress", stickyColor: "#3B82F6", gridCol: 2, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "done",        defaultTitle: "Done",        stickyColor: "#22C55E", gridCol: 3, gridRow: 0, defaultChildCount: 3 },
    ],
    contentSystemPrompt: `Generate kanban board content. Return JSON:
{"backlog":["...","...","..."],"todo":["...","...","..."],"in_progress":["...","...","..."],"done":["...","...","..."]}
Each item: 3-10 words (task descriptions). Exactly 3 per column.`,
  },

  retro: {
    id: "retro",
    name: "Retrospective",
    columns: 3,
    frameGap: 30,
    frames: [
      { titleKey: "went_well",  defaultTitle: "What Went Well",  stickyColor: "#22C55E", gridCol: 0, gridRow: 0, defaultChildCount: 4 },
      { titleKey: "to_improve", defaultTitle: "To Improve",      stickyColor: "#F472B6", gridCol: 1, gridRow: 0, defaultChildCount: 4 },
      { titleKey: "actions",    defaultTitle: "Action Items",    stickyColor: "#3B82F6", gridCol: 2, gridRow: 0, defaultChildCount: 4 },
    ],
    contentSystemPrompt: `Generate retrospective content. Return JSON:
{"went_well":["...","...","...","..."],"to_improve":["...","...","...","..."],"actions":["...","...","...","..."]}
Each point: 3-8 words. Exactly 4 per category.`,
  },

  pros_cons: {
    id: "pros_cons",
    name: "Pros & Cons",
    columns: 2,
    frameGap: 30,
    frames: [
      { titleKey: "pros", defaultTitle: "Pros", stickyColor: "#22C55E", gridCol: 0, gridRow: 0, defaultChildCount: 5 },
      { titleKey: "cons", defaultTitle: "Cons", stickyColor: "#EF4444", gridCol: 1, gridRow: 0, defaultChildCount: 5 },
    ],
    contentSystemPrompt: `Generate pros and cons. Return JSON:
{"pros":["...","...","...","...","..."],"cons":["...","...","...","...","..."]}
Each point: 3-8 words. Exactly 5 per side.`,
  },

  brainstorm: {
    id: "brainstorm",
    name: "Brainstorm",
    columns: 3,
    frameGap: 30,
    frames: [
      { titleKey: "ideas",     defaultTitle: "Ideas",         stickyColor: "#FBBF24", gridCol: 0, gridRow: 0, defaultChildCount: 5 },
      { titleKey: "questions", defaultTitle: "Questions",     stickyColor: "#F472B6", gridCol: 1, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "next",      defaultTitle: "Next Steps",    stickyColor: "#3B82F6", gridCol: 2, gridRow: 0, defaultChildCount: 3 },
    ],
    contentSystemPrompt: `Generate brainstorming content. Return JSON:
{"ideas":["...","...","...","...","..."],"questions":["...","...","..."],"next":["...","...","..."]}
Ideas: 3-8 words each (5 total). Questions: short questions (3). Next steps: actionable items (3).`,
  },

  timeline: {
    id: "timeline",
    name: "Timeline",
    columns: 4,
    frameGap: 30,
    frames: [
      { titleKey: "phase1", defaultTitle: "Phase 1", stickyColor: "#3B82F6", gridCol: 0, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "phase2", defaultTitle: "Phase 2", stickyColor: "#A855F7", gridCol: 1, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "phase3", defaultTitle: "Phase 3", stickyColor: "#F97316", gridCol: 2, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "phase4", defaultTitle: "Phase 4", stickyColor: "#22C55E", gridCol: 3, gridRow: 0, defaultChildCount: 3 },
    ],
    contentSystemPrompt: `Generate timeline/roadmap content. Return JSON:
{"phase1":["...","...","..."],"phase2":["...","...","..."],"phase3":["...","...","..."],"phase4":["...","...","..."]}
Each item: 3-8 words (milestone or task). Exactly 3 per phase.`,
  },

  matrix: {
    id: "matrix",
    name: "2×2 Matrix",
    columns: 2,
    frameGap: 30,
    frames: [
      { titleKey: "high_impact_low_effort",  defaultTitle: "Quick Wins",    stickyColor: "#22C55E", gridCol: 0, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "high_impact_high_effort", defaultTitle: "Big Projects",  stickyColor: "#3B82F6", gridCol: 1, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "low_impact_low_effort",   defaultTitle: "Fill-ins",      stickyColor: "#FBBF24", gridCol: 0, gridRow: 1, defaultChildCount: 3 },
      { titleKey: "low_impact_high_effort",  defaultTitle: "Avoid",         stickyColor: "#EF4444", gridCol: 1, gridRow: 1, defaultChildCount: 3 },
    ],
    contentSystemPrompt: `Generate prioritization matrix content. Return JSON:
{"high_impact_low_effort":["...","...","..."],"high_impact_high_effort":["...","...","..."],"low_impact_low_effort":["...","...","..."],"low_impact_high_effort":["...","...","..."]}
Each item: 3-8 words (task/project). Exactly 3 per quadrant.`,
  },

  mind_map: {
    id: "mind_map",
    name: "Mind Map",
    columns: 3,
    frameGap: 30,
    frames: [
      { titleKey: "central",    defaultTitle: "Central Idea", stickyColor: "#A855F7", gridCol: 1, gridRow: 0, defaultChildCount: 1 },
      { titleKey: "branch_1",   defaultTitle: "Branch 1",     stickyColor: "#3B82F6", gridCol: 0, gridRow: 1, defaultChildCount: 3 },
      { titleKey: "branch_2",   defaultTitle: "Branch 2",     stickyColor: "#22C55E", gridCol: 1, gridRow: 1, defaultChildCount: 3 },
      { titleKey: "branch_3",   defaultTitle: "Branch 3",     stickyColor: "#F97316", gridCol: 2, gridRow: 1, defaultChildCount: 3 },
    ],
    contentSystemPrompt: `Generate mind map content. Return JSON:
{"central":["Main topic"],"branch_1":["...","...","..."],"branch_2":["...","...","..."],"branch_3":["...","...","..."]}
Central: 1 item (the core idea). Branches: 3 items each (3-8 words).`,
  },

  sprint_board: {
    id: "sprint_board",
    name: "Sprint Board",
    columns: 4,
    frameGap: 30,
    frames: [
      { titleKey: "backlog",     defaultTitle: "Sprint Backlog",  stickyColor: "#9CA3AF", gridCol: 0, gridRow: 0, defaultChildCount: 4 },
      { titleKey: "in_progress", defaultTitle: "In Progress",     stickyColor: "#3B82F6", gridCol: 1, gridRow: 0, defaultChildCount: 3 },
      { titleKey: "review",      defaultTitle: "In Review",       stickyColor: "#F97316", gridCol: 2, gridRow: 0, defaultChildCount: 2 },
      { titleKey: "done",        defaultTitle: "Done",            stickyColor: "#22C55E", gridCol: 3, gridRow: 0, defaultChildCount: 2 },
    ],
    contentSystemPrompt: `Generate sprint board content. Return JSON:
{"backlog":["...","...","...","..."],"in_progress":["...","...","..."],"review":["...","..."],"done":["...","..."]}
Each item: task description (3-10 words). Backlog: 4 items, In Progress: 3, Review: 2, Done: 2.`,
  },
};

export function getTemplate(id: string): TemplateSpec | null {
  return TEMPLATES[id] ?? null;
}

export function listTemplateIds(): string[] {
  return Object.keys(TEMPLATES);
}

// ─── Content Generation (small LLM call) ──────────────────────

function extractTopic(command: string, templateId: string): string {
  // Strip template keywords and common prefixes
  let topic = command
    .replace(/\b(create|make|set\s*up|build|generate|add|new)\b/gi, "")
    .replace(/\b(a|an|the|for|about|on|with)\b/gi, "")
    .replace(new RegExp(`\\b${templateId.replace(/_/g, "[\\s_]")}\\b`, "gi"), "")
    .replace(/\b(analysis|board|template|session|brainstorm(?:ing)?|retrospective|retro)\b/gi, "")
    .replace(/\b(swot|kanban|pros\s*(?:and|&|\/)\s*cons|timeline|roadmap|matrix|mind\s*map)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return topic || "general topic";
}

function buildDeterministicContent(
  template: TemplateSpec,
  topic: string
): Record<string, string[]> {
  const subject = topic === "general topic" ? "the initiative" : topic;

  if (template.id === "swot") {
    return {
      strengths: [
        `Strong team expertise in ${subject}`,
        `Clear customer value proposition`,
        `Fast iteration and decision cycles`,
        `Established domain knowledge`,
      ],
      weaknesses: [
        `Limited resources for rapid scale`,
        `Manual processes in key workflows`,
        `Gaps in brand awareness`,
        `Dependency on a few key people`,
      ],
      opportunities: [
        `Growing demand in target market`,
        `Partnership potential with adjacent players`,
        `Automation can unlock efficiency gains`,
        `New channels for customer acquisition`,
      ],
      threats: [
        `Aggressive competitor pricing pressure`,
        `Market conditions may shift quickly`,
        `Regulatory changes could slow rollout`,
        `Customer expectations rising over time`,
      ],
    };
  }

  // Generic deterministic fallback for all other templates
  const content: Record<string, string[]> = {};
  for (const frame of template.frames) {
    content[frame.titleKey] = Array.from(
      { length: frame.defaultChildCount },
      (_, i) => `${frame.defaultTitle} for ${subject} — ${i + 1}`.slice(0, 200)
    );
  }
  return content;
}

export async function generateTemplateContent(
  command: string,
  template: TemplateSpec,
  openaiApiKey: string
): Promise<Record<string, string[]>> {
  const topic = extractTopic(command, template.id);

  // Fast path: if user gave no real topic, skip LLM and stay deterministic.
  // This keeps template creation snappy and avoids unnecessary token usage.
  if (topic === "general topic") {
    return buildDeterministicContent(template, topic);
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  try {
    // Race the LLM call against a short timeout — preserve responsiveness.
    const llmPromise = openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: template.contentSystemPrompt + "\nKeep each item concise — these go on sticky notes.",
        },
        {
          role: "user",
          content: `Topic: ${topic}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0.4,
    });

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000));
    const response = await Promise.race([llmPromise, timeoutPromise]);

    if (!response) {
      throw new Error("timeout");
    }

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    // Validate: ensure all expected keys exist and are arrays
    const content: Record<string, string[]> = {};
    const fallback = buildDeterministicContent(template, topic);

    for (const frame of template.frames) {
      const items = parsed[frame.titleKey];
      if (Array.isArray(items) && items.length > 0) {
        content[frame.titleKey] = items.map((s: any) => String(s).slice(0, 200));
      } else {
        content[frame.titleKey] = fallback[frame.titleKey] ?? [];
      }
    }

    return content;
  } catch {
    // Deterministic fallback keeps latency low and output structured.
    return buildDeterministicContent(template, topic);
  }
}

// ─── Template Execution (deterministic, no LLM) ──────────────

export interface TemplateResult {
  success: boolean;
  createdIds: string[];
  frameIds: string[];
  error?: string;
}

export async function executeTemplate(
  template: TemplateSpec,
  content: Record<string, string[]>,
  ctx: ToolContext,
  viewport: Viewport
): Promise<TemplateResult> {
  const supabase = getSupabaseAdmin();
  const createdIds: string[] = [];
  const frameIds: string[] = [];

  try {
    // ── 1. Compute frame sizes and positions ──
    const frameSizes = template.frames.map((spec) => {
      const childCount = content[spec.titleKey]?.length ?? spec.defaultChildCount;
      return calculateFrameSize(childCount, 150, 150, 3, 1);
    });

    // Find max width/height per column/row for alignment
    const colWidths: number[] = [];
    const rowHeights: number[] = [];
    template.frames.forEach((spec, i) => {
      const { width, height } = frameSizes[i];
      colWidths[spec.gridCol] = Math.max(colWidths[spec.gridCol] ?? 0, width);
      rowHeights[spec.gridRow] = Math.max(rowHeights[spec.gridRow] ?? 0, height);
    });

    // Total grid dimensions
    const totalWidth =
      colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * template.frameGap;
    const totalHeight =
      rowHeights.reduce((a, b) => a + b, 0) + (rowHeights.length - 1) * template.frameGap;

    // Anchor: center the grid on viewport
    const anchorX = viewport.centerX - totalWidth / 2;
    const anchorY = viewport.centerY - totalHeight / 2;

    // Compute X/Y offsets per column/row
    const colX: number[] = [];
    let cx = 0;
    for (let c = 0; c < colWidths.length; c++) {
      colX[c] = cx;
      cx += colWidths[c] + template.frameGap;
    }
    const rowY: number[] = [];
    let ry = 0;
    for (let r = 0; r < rowHeights.length; r++) {
      rowY[r] = ry;
      ry += rowHeights[r] + template.frameGap;
    }

    // ── 2. Create frames ──
    const frameMap: Record<string, string> = {}; // titleKey → frameId

    for (let i = 0; i < template.frames.length; i++) {
      const spec = template.frames[i];
      const { width, height } = frameSizes[i];
      const x = anchorX + colX[spec.gridCol];
      const y = anchorY + rowY[spec.gridRow];

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const obj = {
        id,
        board_id: ctx.boardId,
        type: "frame",
        x,
        y,
        width,
        height,
        color: "#F3F4F6",
        text: spec.defaultTitle,
        rotation: 0,
        z_index: Date.now() - 1000 + i,
        parent_frame_id: null,
        created_by: ctx.uid,
        created_at: now,
        updated_at: now,
      };

      const { error } = await supabase.from("objects").insert(obj);
      if (error) {
        throw new Error(`Failed to create frame "${spec.defaultTitle}": ${error.message}`);
      }

      createdIds.push(id);
      frameIds.push(id);
      frameMap[spec.titleKey] = id;

      ctx.existingObjects.push({
        id,
        type: "frame",
        x,
        y,
        width,
        height,
        color: "#F3F4F6",
        text: spec.defaultTitle,
        rotation: 0,
        zIndex: obj.z_index,
        parentFrameId: null,
      });
    }

    // ── 3. Create stickies inside frames ──
    for (const spec of template.frames) {
      const frameId = frameMap[spec.titleKey];
      if (!frameId) continue;

      const items = content[spec.titleKey] ?? [];
      const frame = ctx.existingObjects.find((o) => o.id === frameId);
      if (!frame) continue;

      // Use grid layout from frame placement engine
      const PADDING = 20;
      const TITLE_H = 40;
      const GAP = 15;
      const contentLeft = frame.x + PADDING;
      const contentTop = frame.y + TITLE_H + PADDING;
      const contentWidth = frame.width - 2 * PADDING;
      const cols = Math.max(1, Math.floor((contentWidth + GAP) / (150 + GAP)));

      for (let j = 0; j < items.length; j++) {
        const row = Math.floor(j / cols);
        const col = j % cols;
        const stickyX = contentLeft + col * (150 + GAP);
        const stickyY = contentTop + row * (150 + GAP);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const zIndex = Date.now() + createdIds.length;

        const obj = {
          id,
          board_id: ctx.boardId,
          type: "sticky",
          x: stickyX,
          y: stickyY,
          width: 150,
          height: 150,
          color: spec.stickyColor,
          text: items[j].slice(0, 500),
          rotation: 0,
          z_index: zIndex,
          parent_frame_id: frameId,
          created_by: ctx.uid,
          created_at: now,
          updated_at: now,
        };

        const { error } = await supabase.from("objects").insert(obj);
        if (error) {
          throw new Error(`Failed to create sticky in "${spec.defaultTitle}": ${error.message}`);
        }

        createdIds.push(id);
        ctx.existingObjects.push({
          id,
          type: "sticky",
          x: stickyX,
          y: stickyY,
          width: 150,
          height: 150,
          color: spec.stickyColor,
          text: obj.text,
          rotation: 0,
          zIndex,
          parentFrameId: frameId,
        });
      }
    }

    return { success: true, createdIds, frameIds };
  } catch (error) {
    // Best-effort rollback to avoid leaving half-built templates on the board.
    if (createdIds.length > 0) {
      try {
        await supabase.from("objects").delete().in("id", createdIds);
      } catch {
        // ignore rollback errors
      }
    }

    return { success: false, createdIds: [], frameIds: [], error: String(error) };
  }
}
