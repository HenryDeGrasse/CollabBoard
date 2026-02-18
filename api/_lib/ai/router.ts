/**
 * Intent router — determines what the user wants so we can:
 *   1. Pick the right model
 *   2. Send only the necessary tools
 *   3. Build a minimal board digest (not the full 200-object dump)
 *
 * Zero LLM calls — pure heuristics. Fast and deterministic.
 */

// ─── Types ────────────────────────────────────────────────────

export type Intent =
  | "create_simple"      // "add a sticky", "make a rectangle"
  | "create_template"    // "create a SWOT / kanban / retro"
  | "edit_selected"      // "make these blue", "move selected right"
  | "edit_specific"      // "change the text on that sticky to…"
  | "delete"             // "delete everything", "remove the stickies"
  | "reorganize"         // "reorganize into columns", "clean up"
  | "query"              // "what's on this board?"
  | "general";           // fallback

export type Scope = "selected" | "viewport" | "board";

export interface RouteResult {
  intent: Intent;
  scope: Scope;
  model: "gpt-4o" | "gpt-4o-mini";
  /** Template name if detected (swot, kanban, retro, etc.) */
  templateId: string | null;
  /** Whether the digest should include the full object list */
  needsFullContext: boolean;
  /** Tool names to send to the model (null = send all) */
  allowedTools: string[] | null;
}

// ─── Patterns ─────────────────────────────────────────────────

const TEMPLATE_PATTERNS: Record<string, RegExp> = {
  // Support: "swot", "s.w.o.t", and phrase variants
  swot:           /\b(?:s\.?\s*w\.?\s*o\.?\s*t\.?|swot|strengths?\s+weaknesses?\s+opportunities?\s+threats?)\b/i,
  kanban:         /\bkanban\b/i,
  retro:          /\bretro(?:spective)?\b/i,
  pros_cons:      /\bpros\s*(?:and|&|\/)\s*cons\b/i,
  brainstorm:     /\bbrainstorm(?:ing)?\b/i,
  timeline:       /\b(?:timeline|roadmap)\b/i,
  mind_map:       /\bmind\s*map\b/i,
  sprint_board:   /\bsprint\s*(?:board|plan)\b/i,
  matrix:         /\bmatrix\b/i,
};

const DELETE_PATTERNS = [
  /\b(?:delete|remove|clear|wipe|erase)\b.*\b(?:all|every|board|everything)\b/i,
  /\b(?:start\s*over|clean\s*slate|reset)\b/i,
  /\b(?:delete|remove|clear)\b/i,
];

const REORG_PATTERNS = [
  /\b(?:reorganize|rearrange|restructure|reorder|tidy|clean\s*up|sort|organize|categorize|group|cluster)\b/i,
  /\b(?:convert|turn|transform)\b.*\b(?:into|to|as)\b/i,
  /\b(?:lay\s*out|arrange|align)\b/i,
];

const QUERY_PATTERNS = [
  /\bwhat(?:'s| is)\b.*\b(?:on|in)\b.*\bboard\b/i,
  /\b(?:summarize|describe|list|show|tell\s*me)\b.*\bboard\b/i,
  /\bhow\s*many\b/i,
];

const SELECTED_PATTERNS = [
  /\b(?:these|selected|this|them|those)\b/i,
  /\b(?:make|change|move|resize|color|update|edit)\b.*\b(?:selected|these|them)\b/i,
];

const CREATE_PATTERNS = [
  /\b(?:add|create|make|put|place|insert|new|generate|write)\b/i,
];

// ─── Template Title Lookup (for routing, avoids circular import) ──

const TEMPLATE_FRAME_TITLES: Record<string, string[]> = {
  swot:         ["strengths", "weaknesses", "opportunities", "threats"],
  kanban:       ["backlog", "to do", "in progress", "done"],
  retro:        ["what went well", "to improve", "action items"],
  pros_cons:    ["pros", "cons"],
  brainstorm:   ["ideas", "questions", "next steps"],
  timeline:     ["phase 1", "phase 2", "phase 3", "phase 4"],
  matrix:       ["quick wins", "big projects", "fill-ins", "avoid"],
  mind_map:     ["central idea", "branch 1", "branch 2", "branch 3"],
  sprint_board: ["sprint backlog", "in progress", "in review", "done"],
};

function getTemplateTitlesForRouting(templateId: string): string[] {
  return TEMPLATE_FRAME_TITLES[templateId] ?? [];
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasLikelyExistingTemplate(
  templateId: string,
  existingFrameTitles: string[]
): boolean {
  const templateTitles = getTemplateTitlesForRouting(templateId);
  if (templateTitles.length === 0) return false;

  const normalizedExisting = existingFrameTitles.map(normalizeTitle);

  const matches = templateTitles.filter((expected) => {
    const needle = normalizeTitle(expected);
    return normalizedExisting.some(
      (title) =>
        title === needle ||
        title.startsWith(`${needle} `) ||
        title.endsWith(` ${needle}`) ||
        title.includes(` ${needle} `)
    );
  }).length;

  // Require strong evidence that the template already exists.
  // This avoids false negatives when just one frame title happens to match
  // (e.g. a lone "Strengths" frame should not block creating a full SWOT).
  const minMatches =
    templateTitles.length <= 2
      ? templateTitles.length
      : Math.max(2, Math.ceil(templateTitles.length * 0.75));

  return matches >= minMatches;
}

// ─── Tool Sets ────────────────────────────────────────────────

// Simple creation: no connectors or arrange needed
const TOOLS_CREATE_SIMPLE = [
  "createStickyNote", "createShape", "createFrame", "bulkCreate",
];

// Full creation: includes connectors and layout tools
const TOOLS_CREATE_FULL = [
  "createStickyNote", "createShape", "createFrame",
  "createConnector", "bulkCreate", "arrangeObjects",
];

const TOOLS_EDIT = [
  "moveObject", "resizeObject", "updateText", "changeColor",
  "addObjectToFrame", "removeObjectFromFrame",
  "arrangeObjects", "rearrangeFrame",
];

const TOOLS_EDIT_SPECIFIC = [
  "createStickyNote", "bulkCreate",
  ...TOOLS_EDIT,
];

const TOOLS_DELETE = ["bulkDelete"];

const TOOLS_QUERY = ["getBoardContext"];

const TOOLS_TEMPLATE = [
  "createFrame", "bulkCreate", "arrangeObjects", "rearrangeFrame",
];

const TOOLS_REORG = [
  "bulkDelete", "bulkCreate", "createFrame",
  "moveObject", "addObjectToFrame", "removeObjectFromFrame",
  "arrangeObjects", "rearrangeFrame", "getBoardContext",
];

// ─── Router ───────────────────────────────────────────────────

/**
 * @param existingFrameTitles  Lowercased titles of frames already on the board.
 *                             Used to avoid re-creating a template that already exists.
 */
export function routeCommand(
  command: string,
  selectedCount: number,
  boardObjectCount: number,
  existingFrameTitles: string[] = []
): RouteResult {
  const cmd = command.toLowerCase().trim();

  // ── Template detection ──
  // Route to template creation when the command matches a template keyword,
  // unless the wording clearly indicates an edit of existing content
  // (e.g. "add to SWOT", "update kanban") or we already have strong
  // evidence that this template is present on the board.
  const CREATION_VERBS = /\b(create|make|set\s*up|build|generate|start)\b/i;
  // "add a sticky to the SWOT", "update the kanban", "put something in the retro"
  const EDIT_VERBS = /\b(?:update|edit|change|modify)\b|\b(?:add|put|insert|move)\b[\s\S]{0,40}\b(?:to|into|in|inside)\b/i;

  for (const [id, re] of Object.entries(TEMPLATE_PATTERNS)) {
    if (re.test(cmd)) {
      // If the command uses edit-like verbs ("add a sticky to the SWOT"),
      // route to targeted edit mode — the user is modifying, not creating.
      if (EDIT_VERBS.test(cmd) && !CREATION_VERBS.test(cmd)) {
        return {
          intent: "edit_specific",
          scope: "board",
          model: "gpt-4o-mini",
          templateId: null,
          needsFullContext: false,
          allowedTools: TOOLS_EDIT_SPECIFIC,
        };
      }

      // If frames matching this template already exist AND no creation verb,
      // fall through — the user is likely referring to the existing template.
      const hasExisting = hasLikelyExistingTemplate(id, existingFrameTitles);
      if (hasExisting && !CREATION_VERBS.test(cmd)) break;

      return {
        intent: "create_template",
        scope: "viewport",
        model: "gpt-4o-mini",
        templateId: id,
        needsFullContext: false,
        allowedTools: TOOLS_TEMPLATE,
      };
    }
  }

  // ── Query ──
  for (const re of QUERY_PATTERNS) {
    if (re.test(cmd)) {
      return {
        intent: "query",
        scope: "board",
        model: "gpt-4o-mini",
        templateId: null,
        needsFullContext: false, // digest summary is enough; model can call getBoardContext to drill in
        allowedTools: TOOLS_QUERY,
      };
    }
  }

  // ── Delete ──
  for (const re of DELETE_PATTERNS) {
    if (re.test(cmd)) {
      return {
        intent: "delete",
        scope: boardObjectCount > 0 ? "board" : "viewport",
        model: "gpt-4o-mini",
        templateId: null,
        needsFullContext: boardObjectCount <= 50,
        allowedTools: [...TOOLS_DELETE, "getBoardContext"],
      };
    }
  }

  // ── Reorganize ──
  for (const re of REORG_PATTERNS) {
    if (re.test(cmd)) {
      return {
        intent: "reorganize",
        scope: selectedCount > 0 ? "selected" : "board",
        model: "gpt-4o",
        templateId: null,
        needsFullContext: true,
        allowedTools: TOOLS_REORG,
      };
    }
  }

  // ── Edit selected ──
  if (selectedCount > 0) {
    for (const re of SELECTED_PATTERNS) {
      if (re.test(cmd)) {
        return {
          intent: "edit_selected",
          scope: "selected",
          model: "gpt-4o-mini",
          templateId: null,
          needsFullContext: false,
          allowedTools: TOOLS_EDIT,
        };
      }
    }
  }

  // ── Simple create ──
  for (const re of CREATE_PATTERNS) {
    if (re.test(cmd)) {
      // Needs connectors or layout? ("create … and connect them", "arrange in a row")
      const needsConnectors = /\bconnect|arrow|link\b/i.test(cmd);
      const needsArrange = /\barrange|grid|row|column|layout|align\b/i.test(cmd);
      const needsFullTools = needsConnectors || needsArrange;

      // Model: gpt-4o-mini handles all pure creation. Reserve gpt-4o for
      // complex multi-step commands (long prompt + many conjunctions).
      const isComplex =
        cmd.length > 150 &&
        (cmd.match(/\band\b/g) || []).length >= 3;

      return {
        intent: "create_simple",
        scope: "viewport",
        model: isComplex ? "gpt-4o" : "gpt-4o-mini",
        templateId: null,
        needsFullContext: false,
        allowedTools: needsFullTools ? TOOLS_CREATE_FULL : TOOLS_CREATE_SIMPLE,
      };
    }
  }

  // ── Fallback: general ──
  return {
    intent: "general",
    scope: selectedCount > 0 ? "selected" : "viewport",
    model: boardObjectCount > 30 ? "gpt-4o" : "gpt-4o-mini",
    templateId: null,
    needsFullContext: boardObjectCount <= 50,
    allowedTools: null, // send all tools
  };
}
