import { describe, it, expect } from "vitest";

// Inline copy of routing logic for testing (mirrors api/_lib/ai/router.ts).
// We can't import server-only code into vitest, so we replicate the core rules.

const TEMPLATE_PATTERNS: Record<string, RegExp> = {
  swot: /\b(?:s\.?\s*w\.?\s*o\.?\s*t\.?|swot|strengths?\s+weaknesses?\s+opportunities?\s+threats?)\b/i,
  kanban: /\bkanban\b/i,
  retro: /\bretro(?:spective)?\b/i,
  pros_cons: /\bpros\s*(?:and|&|\/)\s*cons\b/i,
  brainstorm: /\bbrainstorm(?:ing)?\b/i,
  timeline: /\b(?:timeline|roadmap)\b/i,
};

const TEMPLATE_FRAME_TITLES: Record<string, string[]> = {
  swot: ["strengths", "weaknesses", "opportunities", "threats"],
  kanban: ["backlog", "to do", "in progress", "done"],
  retro: ["what went well", "to improve", "action items"],
  pros_cons: ["pros", "cons"],
  brainstorm: ["ideas", "questions", "next steps"],
  timeline: ["phase 1", "phase 2", "phase 3", "phase 4"],
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
const SELECTED_PATTERNS = [/\b(?:these|selected|this|them|those)\b/i];
const CREATE_PATTERNS = [/\b(?:add|create|make|put|place|insert|new|generate|write)\b/i];
const CREATION_VERBS = /\b(create|make|set\s*up|build|generate|start)\b/i;
const EDIT_VERBS = /\b(?:update|edit|change|modify)\b|\b(?:add|put|insert|move)\b[\s\S]{0,40}\b(?:to|into|in|inside)\b/i;

interface RouteResult {
  intent: string;
  templateId: string | null;
  [key: string]: any;
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
  const templateTitles = TEMPLATE_FRAME_TITLES[templateId] ?? [];
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

  const minMatches =
    templateTitles.length <= 2
      ? templateTitles.length
      : Math.max(2, Math.ceil(templateTitles.length * 0.75));

  return matches >= minMatches;
}

function routeCommand(
  command: string,
  selectedCount: number,
  boardObjectCount: number,
  existingFrameTitles: string[] = []
): RouteResult {
  const cmd = command.toLowerCase().trim();

  for (const [id, re] of Object.entries(TEMPLATE_PATTERNS)) {
    if (re.test(cmd)) {
      if (EDIT_VERBS.test(cmd) && !CREATION_VERBS.test(cmd)) {
        return { intent: "edit_specific", templateId: null };
      }
      const hasExisting = hasLikelyExistingTemplate(id, existingFrameTitles);
      if (hasExisting && !CREATION_VERBS.test(cmd)) break;

      return { intent: "create_template", templateId: id };
    }
  }

  for (const re of QUERY_PATTERNS) {
    if (re.test(cmd)) return { intent: "query", templateId: null };
  }
  for (const re of DELETE_PATTERNS) {
    if (re.test(cmd)) return { intent: "delete", templateId: null };
  }
  for (const re of REORG_PATTERNS) {
    if (re.test(cmd)) return { intent: "reorganize", templateId: null };
  }
  if (selectedCount > 0) {
    for (const re of SELECTED_PATTERNS) {
      if (re.test(cmd)) return { intent: "edit_selected", templateId: null };
    }
  }
  for (const re of CREATE_PATTERNS) {
    if (re.test(cmd)) return { intent: "create_simple", templateId: null };
  }

  return { intent: "general", templateId: null };
}

// ─── Tests ────────────────────────────────────────────────────

describe("AI Intent Router", () => {
  describe("template creation", () => {
    it("routes 'create a SWOT analysis' as template on empty board", () => {
      const r = routeCommand("create a SWOT analysis", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("swot");
    });

    it("routes dotted acronym 'S.W.O.T' as template", () => {
      const r = routeCommand("make a S.W.O.T board for launch", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("swot");
    });

    it("routes expanded phrase 'strengths weaknesses opportunities threats' as SWOT", () => {
      const r = routeCommand(
        "set up strengths weaknesses opportunities threats for product",
        0,
        0
      );
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("swot");
    });

    it("routes 'make a kanban board' as template", () => {
      const r = routeCommand("make a kanban board", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("kanban");
    });

    it("routes 'set up a retrospective' as template", () => {
      const r = routeCommand("set up a retrospective", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("retro");
    });

    it("routes 'create pros and cons' as template", () => {
      const r = routeCommand("create a pros and cons list", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("pros_cons");
    });

    it("routes 'brainstorming session' as template with creation verb", () => {
      const r = routeCommand("set up a brainstorming session", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("brainstorm");
    });

    it("routes roadmap requests to timeline template", () => {
      const r = routeCommand("create a roadmap for q3", 0, 0);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("timeline");
    });
  });

  describe("template vs edit disambiguation", () => {
    it("routes 'add a sticky to the SWOT' as edit_specific (not template)", () => {
      const r = routeCommand(
        "add a sticky note to the SWOT strengths",
        0,
        20,
        ["strengths", "weaknesses", "opportunities", "threats"]
      );
      expect(r.intent).toBe("edit_specific");
    });

    it("routes 'put a new item in the SWOT frame' as edit_specific", () => {
      const r = routeCommand(
        "put a new item in the SWOT weaknesses frame",
        0,
        16,
        ["strengths", "weaknesses", "opportunities", "threats"]
      );
      expect(r.intent).toBe("edit_specific");
    });

    it("routes 'update the kanban board' as edit_specific", () => {
      const r = routeCommand(
        "update the kanban board with new tasks",
        0,
        12,
        ["backlog", "to do", "in progress", "done"]
      );
      expect(r.intent).toBe("edit_specific");
    });

    it("DOES create template with explicit 'create' even when SWOT exists", () => {
      const r = routeCommand(
        "create a new SWOT analysis",
        0,
        16,
        ["strengths", "weaknesses", "opportunities", "threats"]
      );
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("swot");
    });

    it("DOES create template for bare 'swot' on board with no existing SWOT frames", () => {
      const r = routeCommand("swot analysis for my startup", 0, 10);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("swot");
    });

    it("does NOT create template for bare 'swot' when SWOT frames exist", () => {
      const r = routeCommand("swot", 0, 16, ["strengths", "weaknesses", "opportunities", "threats"]);
      expect(r.intent).not.toBe("create_template");
    });

    it("still creates template when only one matching frame exists", () => {
      const r = routeCommand("swot", 0, 16, ["strengths"]);
      expect(r.intent).toBe("create_template");
      expect(r.templateId).toBe("swot");
    });

    it("treats 3 of 4 SWOT quadrants as an existing template", () => {
      const r = routeCommand("swot", 0, 16, ["strengths", "weaknesses", "opportunities"]);
      expect(r.intent).not.toBe("create_template");
    });

    it("DOES create template for 'create a SWOT' even on non-empty board", () => {
      const r = routeCommand("create a SWOT analysis for our product", 0, 10);
      expect(r.intent).toBe("create_template");
    });

    it("routes 'move this to the retro board' as edit_specific", () => {
      const r = routeCommand(
        "move this to the retro board",
        1,
        8,
        ["what went well", "to improve", "action items"]
      );
      expect(r.intent).toBe("edit_specific");
    });
  });

  describe("delete detection", () => {
    it("routes 'delete everything' as delete", () => {
      const r = routeCommand("delete everything on the board", 0, 20);
      expect(r.intent).toBe("delete");
    });

    it("routes 'clear the board' as delete", () => {
      const r = routeCommand("clear the board", 0, 10);
      expect(r.intent).toBe("delete");
    });

    it("routes 'start over' as delete", () => {
      const r = routeCommand("start over", 0, 5);
      expect(r.intent).toBe("delete");
    });
  });

  describe("reorganize detection", () => {
    it("routes 'reorganize into columns' as reorganize", () => {
      const r = routeCommand("reorganize everything into columns", 0, 20);
      expect(r.intent).toBe("reorganize");
    });

    it("routes 'tidy up the board' as reorganize", () => {
      const r = routeCommand("tidy up the board", 0, 10);
      expect(r.intent).toBe("reorganize");
    });

    it("routes 'arrange these in a grid' as reorganize", () => {
      const r = routeCommand("arrange these in a grid", 3, 10);
      expect(r.intent).toBe("reorganize");
    });
  });

  describe("query detection", () => {
    it("routes 'what's on the board' as query", () => {
      const r = routeCommand("what's on the board?", 0, 10);
      expect(r.intent).toBe("query");
    });

    it("routes 'how many stickies' as query", () => {
      const r = routeCommand("how many stickies are there?", 0, 10);
      expect(r.intent).toBe("query");
    });
  });

  describe("edit selected", () => {
    it("routes 'make these blue' with selection", () => {
      const r = routeCommand("make these blue", 3, 10);
      expect(r.intent).toBe("edit_selected");
    });

    it("falls through without selection", () => {
      const r = routeCommand("make these blue", 0, 10);
      expect(r.intent).not.toBe("edit_selected");
    });
  });

  describe("simple create", () => {
    it("routes 'add a yellow sticky' as create_simple", () => {
      const r = routeCommand("add a yellow sticky", 0, 0);
      expect(r.intent).toBe("create_simple");
    });

    it("routes 'create 5 sticky notes about cooking'", () => {
      const r = routeCommand("create 5 sticky notes about cooking", 0, 0);
      expect(r.intent).toBe("create_simple");
    });
  });

  describe("fallback", () => {
    it("routes unknown commands as general", () => {
      const r = routeCommand("do something cool", 0, 10);
      expect(r.intent).toBe("general");
    });
  });
});
