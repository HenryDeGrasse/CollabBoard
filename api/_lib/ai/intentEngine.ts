import type { Intent } from "./router.js";

export type RouteSource = "fast_path" | "ai_extractor" | "full_agent";

export type FastPathMatch =
  | { kind: "delete_all" }
  | {
      kind: "delete_by_type";
      objectType:
        | "sticky"
        | "rectangle"
        | "circle"
        | "frame"
        | "connector"
        | "shape";
    }
  | { kind: "delete_shapes_except"; keep: "circle" | "rectangle" }
  | { kind: "create_sticky_batch"; count: number; topic?: string; color?: string }
  | { kind: "create_single_sticky"; text: string; color?: string; frameName?: string }
  | { kind: "create_shape_batch"; count: number; shape: "rectangle" | "circle"; color?: string }
  | { kind: "query_summary" };

export interface IntentDecision {
  source: RouteSource;
  confidence: number;
  reason: string;
  match: FastPathMatch | null;
}

/**
 * Deterministic parser for high-frequency command shapes.
 * Returns null when command is ambiguous or outside the supported subset.
 */
export function parseFastPath(command: string): FastPathMatch | null {
  const cmd = command.trim();
  const lc = cmd.toLowerCase();

  // Specific exclusion pattern we can handle deterministically.
  const deleteShapesExcept = cmd.match(
    /\b(?:delete|remove|clear)\b\s+all\s+shapes\s+except\s+(circles?|rectangles?)\b/i
  );
  if (deleteShapesExcept) {
    const keep = deleteShapesExcept[1].toLowerCase().startsWith("circle")
      ? "circle"
      : "rectangle";
    return { kind: "delete_shapes_except", keep };
  }

  // Generic exclusions are not deterministic enough.
  if (/\bexcept\b|\bexcluding\b|\bbut\s+not\b/i.test(cmd)) {
    return null;
  }

  // Delete by type
  const deleteType = cmd.match(
    /\b(delete|remove|clear)\b\s+(?:all\s+)?(?:the\s+)?(sticky notes?|stickies|rectangles?|circles?|frames?|connectors?|shapes?)\b/i
  );
  if (deleteType) {
    const raw = deleteType[2].toLowerCase();
    const objectType = raw.startsWith("sticky")
      ? "sticky"
      : raw.startsWith("rectangle")
      ? "rectangle"
      : raw.startsWith("circle")
      ? "circle"
      : raw.startsWith("frame")
      ? "frame"
      : raw.startsWith("connector")
      ? "connector"
      : "shape";
    return { kind: "delete_by_type", objectType };
  }

  // Delete everything
  if (
    /\b(delete|remove|clear|wipe|erase|nuke|purge)\b.*\b(all|everything|board)\b/i.test(cmd) ||
    /\bstart\s*over\b/i.test(cmd)
  ) {
    return { kind: "delete_all" };
  }

  // Add/create a sticky in a named frame: "... to the Strengths frame"
  const addToFrame = cmd.match(
    /\b(?:add|create|make)\b\s+(?:a|an|one)?\s*(?:(yellow|pink|blue|green|orange|purple|red|gray|grey|white)\s+)?sticky(?:\s+note)?(?:\s+that\s+says\s+["“]?(.+?)["”]?)?\s+to\s+(?:the\s+)?(.+?)\s+frame\b/i
  );
  if (addToFrame) {
    const [, color, text, frameName] = addToFrame;
    return {
      kind: "create_single_sticky",
      text: (text || "New note").trim(),
      color: color?.toLowerCase(),
      frameName: frameName.trim(),
    };
  }

  // Single sticky: "add a green sticky note that says hello"
  const addSingleSticky = cmd.match(
    /\b(?:add|create|make)\b\s+(?:a|an|one)?\s*(?:(yellow|pink|blue|green|orange|purple|red|gray|grey|white)\s+)?sticky(?:\s+note)?(?:\s+that\s+says\s+["“]?(.+?)["”]?)?\b/i
  );
  if (addSingleSticky) {
    const [, color, text] = addSingleSticky;
    return {
      kind: "create_single_sticky",
      text: (text || "New note").trim(),
      color: color?.toLowerCase(),
    };
  }

  // Batch sticky notes: "create 5 sticky notes about productivity"
  // Also supports phrasing like "throw 7 quick sticky notes on ideas".
  const batchSticky = cmd.match(
    /\b(?:create|add|make|put|throw)\b[^\d]*(\d{1,3})\b(?:\s+\w+){0,3}\s+(?:(yellow|pink|blue|green|orange|purple|red|gray|grey|white)\s+)?sticky\s*notes?(?:\s+(?:about|on)\s+(.+))?\??$/i
  );
  if (batchSticky) {
    const count = Number(batchSticky[1]);
    if (count >= 2 && count <= 100) {
      return {
        kind: "create_sticky_batch",
        count,
        color: batchSticky[2]?.toLowerCase(),
        topic: batchSticky[3]?.trim(),
      };
    }
  }

  // Batch shapes: "create 3 blue rectangles"
  // Avoid mixed-shape commands like "3 circles and 2 rectangles" (needs full agent).
  if (/\band\b/i.test(cmd)) {
    return null;
  }

  const batchShape = cmd.match(
    /\b(?:create|add|make)\b\s+(\d{1,3})\s+(?:(yellow|pink|blue|green|orange|purple|red|gray|grey|white)\s+)?(rectangles?|circles?)\b/i
  );
  if (batchShape) {
    const count = Number(batchShape[1]);
    if (count >= 2 && count <= 100) {
      return {
        kind: "create_shape_batch",
        count,
        color: batchShape[2]?.toLowerCase(),
        shape: batchShape[3].toLowerCase().startsWith("circle")
          ? "circle"
          : "rectangle",
      };
    }
  }

  // Query summary: "what is on this board", "how many objects"
  if (
    /\bwhat(?:'s|\s+is)\b.*\b(on|in)\b.*\bboard\b/i.test(lc) ||
    /\bhow\s+many\b.*\b(objects?|stick(?:y|ies)|frames?|rectangles?|circles?)\b/i.test(lc) ||
    /\bsummarize\b.*\bboard\b/i.test(lc)
  ) {
    return { kind: "query_summary" };
  }

  return null;
}

function confidenceForMatch(match: FastPathMatch): number {
  switch (match.kind) {
    case "delete_all":
      return 0.99;
    case "delete_by_type":
      return 0.98;
    case "delete_shapes_except":
      return 0.95;
    case "create_sticky_batch":
      return 0.97;
    case "create_shape_batch":
      return 0.97;
    case "create_single_sticky":
      return match.frameName ? 0.96 : 0.95;
    case "query_summary":
      return 0.94;
    default:
      return 0.9;
  }
}

function shouldTryAIExtractor(command: string, intent: Intent): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0 || trimmed.length > 240) return false;

  // Allow extractor for explicit simple intents.
  if (["create_simple", "delete", "edit_specific", "query"].includes(intent)) {
    if ((trimmed.match(/\band\b/gi) || []).length >= 4) return false;
    return true;
  }

  // Also allow extractor from general intent when command contains clear
  // simple-action keywords but router didn't classify it.
  if (intent === "general") {
    const looksSimple = /\b(sticky|stickies|rectangle|rectangles|circle|circles|delete|remove|clear|nuke|how many|what\s+is\s+on\s+this\s+board)\b/i.test(trimmed);
    return looksSimple;
  }

  return false;
}

/**
 * Decide which route source should run this command.
 * - fast_path: deterministic parser matched with high confidence
 * - ai_extractor: lightweight structured extraction for near-deterministic commands
 * - full_agent: normal planner/tool-loop pipeline
 */
export function decideIntentRoute(command: string, intent: Intent): IntentDecision {
  const match = parseFastPath(command);
  if (match) {
    return {
      source: "fast_path",
      confidence: confidenceForMatch(match),
      reason: `regex_match:${match.kind}`,
      match,
    };
  }

  if (shouldTryAIExtractor(command, intent)) {
    return {
      source: "ai_extractor",
      confidence: 0.45,
      reason: "simple_intent_without_regex_match",
      match: null,
    };
  }

  return {
    source: "full_agent",
    confidence: 0.25,
    reason: "default_full_agent",
    match: null,
  };
}
