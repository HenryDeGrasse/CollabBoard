/**
 * AI Agent Loop — GPT-4o with tool calling + streaming
 *
 * Runs a multi-turn conversation where the LLM can call tools
 * (create/update/delete objects) and read intermediate board state.
 * Streams text tokens back to the client in real time.
 */
import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import { createExecutionPlan, validateExecutionPlan } from "./aiPlanner.js";
import { TOOL_DEFINITIONS, executeTool } from "./aiTools.js";

// Default tracing to enabled so production traces are captured even when
// LANGSMITH_TRACING is absent from the environment. Explicit "false" still wins.
process.env.LANGSMITH_TRACING ??= "true";

const MAX_ITERATIONS = 12;

// ─── Complexity routing ────────────────────────────────────────
// Classify the command with a zero-cost heuristic so simple requests
// stay on the fast/cheap model and complex ones get the smarter one.

const COMPLEX_KEYWORDS = [
  // Templates / multi-step patterns
  "swot", "kanban", "retrospective", "retro", "sprint", "mind map", "mindmap",
  "flowchart", "flow chart", "roadmap", "gantt", "timeline", "matrix",
  "hierarchy", "org chart", "tree",
  // Relational / conditional language
  "for each", "for every", "based on", "connect all", "link all",
  "between each", "hierarchy", "depends on", "if ", "otherwise",
  // Multi-action conjunctions
  " then ", " and then ", " after that ", " followed by ",
  // Scale
  "entire board", "everything", "all of the", "each of the",
];

const COMPLEX_ACTION_VERBS = [
  "reorganize", "restructure", "rearrange", "layout", "arrange",
  "distribute", "align", "group", "cluster", "sort", "categorize",
];

export function classifyComplexity(command: string): "simple" | "complex" {
  const lower = command.toLowerCase();

  // Long commands are usually multi-step
  if (command.length > 200) return "complex";

  // Multiple sentences → multiple steps
  const sentences = command.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length > 2) return "complex";

  if (COMPLEX_KEYWORDS.some(kw => lower.includes(kw))) return "complex";
  if (COMPLEX_ACTION_VERBS.some(v => lower.includes(v))) return "complex";

  // Count distinct action verbs — 3+ implies multi-step
  const actionVerbs = ["create", "delete", "move", "connect", "update", "add", "remove", "make", "change", "fill", "set"];
  const verbCount = actionVerbs.filter(v => lower.includes(v)).length;
  if (verbCount >= 3) return "complex";

  return "simple";
}

export const MODEL_SIMPLE  = "gpt-4.1-mini"; // 200k TPM, fast, cheap
export const MODEL_COMPLEX = "gpt-4.1";      // smarter spatial + multi-step reasoning

const TOOL_BY_NAME = new Map(
  TOOL_DEFINITIONS.map((tool) => [tool.function.name, tool] as const)
);

function hasKeyword(commandLower: string, keywords: string[]) {
  return keywords.some((kw) => commandLower.includes(kw));
}

const TOOL_GROUPS = {
  // Core CRUD — always available. Excludes destructive maintenance tools
  // and layout templates to keep the tool list compact for simple commands.
  core: [
    "create_objects",
    "bulk_create_objects",
    "create_connectors",
    "update_objects",
    "update_objects_by_filter",
    "delete_objects",
    "delete_objects_by_filter",
    "delete_connectors",
    "search_objects",
    "get_board_context",
    "read_board_state",
    "navigate_to_objects",
  ],
  selection: ["arrange_objects", "duplicate_objects"],
  layout: [
    "createQuadrant",
    "createColumnLayout",
    "createMindMap",
    "createFlowchart",
    "createWireframe",
  ],
  maintenance: ["fit_frames_to_contents", "clear_board"],
} as const;

export function selectToolDefinitions(
  command: string,
  complexity: "simple" | "complex",
  hasSelection: boolean
) {
  const lower = command.toLowerCase();
  const selectedNames = new Set<string>(TOOL_GROUPS.core);

  // Selection-aware tools: only added when relevant to avoid tool clutter.
  if (hasSelection || hasKeyword(lower, ["selected", "align", "distribute", "grid", "duplicate", "copy", "arrange"])) {
    for (const name of TOOL_GROUPS.selection) selectedNames.add(name);
  }

  const layoutRequested =
    complexity === "complex" ||
    hasKeyword(lower, [
      "swot",
      "kanban",
      "retro",
      "retrospective",
      "mind map",
      "mindmap",
      "flowchart",
      "flow chart",
      "wireframe",
      "layout",
      "column",
      "quadrant",
      "matrix",
      "diagram",
      "reorganize",
      "organize",
      "categorize",
      "group",
    ]);

  if (layoutRequested) {
    for (const name of TOOL_GROUPS.layout) selectedNames.add(name);
  }

  if (complexity === "complex" || hasKeyword(lower, ["fit frame", "fit frames", "tighten frame", "resize frame"])) {
    selectedNames.add("fit_frames_to_contents");
  }

  if (hasKeyword(lower, ["clear board", "wipe board", "empty board", "start over", "delete everything"])) {
    selectedNames.add("clear_board");
  }

  return Array.from(selectedNames)
    .map((name) => TOOL_BY_NAME.get(name))
    .filter((tool): tool is (typeof TOOL_DEFINITIONS)[number] => Boolean(tool));
}

// ─── Fast-path handlers ────────────────────────────────────────
// Bypass the general agent loop for well-known template requests.
// These run a cheap content-generation call + deterministic template tool.

interface FastPathMatch {
  pattern: RegExp;
  handler: (
    match: RegExpMatchArray,
    command: string,
    boardId: string,
    userId: string,
    openaiApiKey: string,
    context: { screenSize?: ScreenSizeInput; selectedIds?: string[]; viewportCenter?: { x: number; y: number } }
  ) => AsyncGenerator<AgentStreamEvent>;
}

const FAST_PATHS: FastPathMatch[] = [
  {
    pattern: /\b(?:create|make|build|set\s*up|generate)\b.*\bswot\b(?:\s+(?:analysis|matrix))?(?:\s+(?:for|about|on)\s+(.+))?/i,
    handler: fastPathSWOT,
  },
  {
    pattern: /\b(?:create|make|build|set\s*up|generate)\b.*\b(?:kanban)\s*(?:board)?(?:\s+(?:for|about|on)\s+(.+))?/i,
    handler: fastPathKanban,
  },
  {
    pattern: /\b(?:create|make|build|set\s*up|generate)\b.*\b(?:retro(?:spective)?)\s*(?:board)?(?:\s+(?:for|about|on)\s+(.+))?/i,
    handler: fastPathRetro,
  },
];

export function hasFastPathMatch(command: string): boolean {
  return FAST_PATHS.some((fp) => fp.pattern.test(command));
}

async function* fastPathSWOT(
  match: RegExpMatchArray,
  _command: string,
  boardId: string,
  userId: string,
  openaiApiKey: string,
  context: { screenSize?: ScreenSizeInput; selectedIds?: string[]; viewportCenter?: { x: number; y: number } }
): AsyncGenerator<AgentStreamEvent> {
  const topic = match[1]?.trim() || "the project";

  yield { type: "meta", content: JSON.stringify({ model: MODEL_SIMPLE, complexity: "fast-path", contextScope: "none", boardObjectCount: 0, boardConnectorCount: 0, contextChars: 0 }) };
  yield { type: "tool_start", content: "createQuadrant" };

  const openai = new OpenAI({ apiKey: openaiApiKey });
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.7,
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Generate SWOT analysis items. Return JSON: {\"strengths\":[...],\"weaknesses\":[...],\"opportunities\":[...],\"threats\":[...]} with 3-5 concise items (under 60 chars each) per category. No numbering." },
      { role: "user", content: `SWOT analysis for: ${topic}` },
    ],
  });

  let content: any = {};
  try { content = JSON.parse(resp.choices[0]?.message?.content || "{}"); } catch { /* empty */ }

  const result = await executeTool("createQuadrant", {
    title: `SWOT Analysis: ${topic}`,
    quadrantLabels: { topLeft: "Strengths", topRight: "Weaknesses", bottomLeft: "Opportunities", bottomRight: "Threats" },
    items: {
      topLeft: content.strengths || ["Add strengths"],
      topRight: content.weaknesses || ["Add weaknesses"],
      bottomLeft: content.opportunities || ["Add opportunities"],
      bottomRight: content.threats || ["Add threats"],
    },
    startX: context.viewportCenter?.x ? context.viewportCenter.x - 400 : undefined,
    startY: context.viewportCenter?.y ? context.viewportCenter.y - 300 : undefined,
  }, boardId, userId, { screenSize: context.screenSize, selectedIds: context.selectedIds, viewportCenter: context.viewportCenter }, openaiApiKey);

  yield { type: "tool_result", content: JSON.stringify({ tool: "createQuadrant", result }) };

  const nav = await executeTool("navigate_to_objects", { ids: [] }, boardId, userId, { screenSize: context.screenSize }, openaiApiKey);
  if ((nav as any)?._viewport) {
    yield { type: "navigate", content: JSON.stringify((nav as any)._viewport) };
  }

  yield { type: "text", content: `Created a SWOT analysis for "${topic}" with ${(result as any).created || 0} objects.` };
  yield { type: "done", content: "" };
}

async function* fastPathKanban(
  match: RegExpMatchArray,
  _command: string,
  boardId: string,
  userId: string,
  openaiApiKey: string,
  context: { screenSize?: ScreenSizeInput; selectedIds?: string[]; viewportCenter?: { x: number; y: number } }
): AsyncGenerator<AgentStreamEvent> {
  const topic = match[1]?.trim() || "Project Tasks";

  yield { type: "meta", content: JSON.stringify({ model: MODEL_SIMPLE, complexity: "fast-path", contextScope: "none", boardObjectCount: 0, boardConnectorCount: 0, contextChars: 0 }) };
  yield { type: "tool_start", content: "createColumnLayout" };

  const openai = new OpenAI({ apiKey: openaiApiKey });
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.7,
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Generate Kanban board items. Return JSON: {\"backlog\":[...],\"todo\":[...],\"in_progress\":[...],\"done\":[...]} with 2-4 concise task items (under 60 chars each) per column. No numbering." },
      { role: "user", content: `Kanban board for: ${topic}` },
    ],
  });

  let content: any = {};
  try { content = JSON.parse(resp.choices[0]?.message?.content || "{}"); } catch { /* empty */ }

  const result = await executeTool("createColumnLayout", {
    title: `Kanban: ${topic}`,
    columns: [
      { title: "Backlog", items: content.backlog || [] },
      { title: "To Do", items: content.todo || [] },
      { title: "In Progress", items: content.in_progress || [] },
      { title: "Done", items: content.done || [] },
    ],
    startX: context.viewportCenter?.x ? context.viewportCenter.x - 400 : undefined,
    startY: context.viewportCenter?.y ? context.viewportCenter.y - 300 : undefined,
  }, boardId, userId, { screenSize: context.screenSize, selectedIds: context.selectedIds, viewportCenter: context.viewportCenter }, openaiApiKey);

  yield { type: "tool_result", content: JSON.stringify({ tool: "createColumnLayout", result }) };

  const nav = await executeTool("navigate_to_objects", { ids: [] }, boardId, userId, { screenSize: context.screenSize }, openaiApiKey);
  if ((nav as any)?._viewport) {
    yield { type: "navigate", content: JSON.stringify((nav as any)._viewport) };
  }

  yield { type: "text", content: `Created a Kanban board for "${topic}" with ${(result as any).created || 0} objects.` };
  yield { type: "done", content: "" };
}

async function* fastPathRetro(
  match: RegExpMatchArray,
  _command: string,
  boardId: string,
  userId: string,
  openaiApiKey: string,
  context: { screenSize?: ScreenSizeInput; selectedIds?: string[]; viewportCenter?: { x: number; y: number } }
): AsyncGenerator<AgentStreamEvent> {
  const topic = match[1]?.trim() || "Sprint";

  yield { type: "meta", content: JSON.stringify({ model: MODEL_SIMPLE, complexity: "fast-path", contextScope: "none", boardObjectCount: 0, boardConnectorCount: 0, contextChars: 0 }) };
  yield { type: "tool_start", content: "createColumnLayout" };

  const openai = new OpenAI({ apiKey: openaiApiKey });
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.7,
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Generate retrospective items. Return JSON: {\"went_well\":[...],\"to_improve\":[...],\"action_items\":[...]} with 2-4 concise items (under 60 chars each) per category. No numbering." },
      { role: "user", content: `Sprint retrospective for: ${topic}` },
    ],
  });

  let content: any = {};
  try { content = JSON.parse(resp.choices[0]?.message?.content || "{}"); } catch { /* empty */ }

  const result = await executeTool("createColumnLayout", {
    title: `Retrospective: ${topic}`,
    columns: [
      { title: "Went Well", items: content.went_well || [] },
      { title: "To Improve", items: content.to_improve || [] },
      { title: "Action Items", items: content.action_items || [] },
    ],
    startX: context.viewportCenter?.x ? context.viewportCenter.x - 300 : undefined,
    startY: context.viewportCenter?.y ? context.viewportCenter.y - 300 : undefined,
  }, boardId, userId, { screenSize: context.screenSize, selectedIds: context.selectedIds, viewportCenter: context.viewportCenter }, openaiApiKey);

  yield { type: "tool_result", content: JSON.stringify({ tool: "createColumnLayout", result }) };

  const nav = await executeTool("navigate_to_objects", { ids: [] }, boardId, userId, { screenSize: context.screenSize }, openaiApiKey);
  if ((nav as any)?._viewport) {
    yield { type: "navigate", content: JSON.stringify((nav as any)._viewport) };
  }

  yield { type: "text", content: `Created a retrospective board for "${topic}" with ${(result as any).created || 0} objects.` };
  yield { type: "done", content: "" };
}

export const SYSTEM_PROMPT = `You are an AI assistant for CollabBoard, a collaborative whiteboard app. You modify the board exclusively through tool calls.

## Defaults
- Sticky: 150x150, Rectangle: 200x150, Frame: 800x600. Frames need ~40px side padding, ~60px top for title.
- Colors — Sticky: yellow #FAD84E, pink #F5A8C4, blue #7FC8E8, green #9DD9A3, grey #E5E5E0. Shape: black #111111, red #CC0000, blue #3B82F6. Frame: #F9F9F7.
- Place new objects near the user's viewport center (provided below), not at (0,0) or (100,100).
- Use ~20px gaps. Use layout:"vertical" in bulk_create_objects when filling column frames.

## Tool selection
- **Many similar objects** -> bulk_create_objects (auto-layout, contentPrompt for unique text)
- **SWOT / 2x2 matrix** -> createQuadrant
- **Kanban / Retro / columns** -> createColumnLayout
- **Mind map / brainstorm** -> createMindMap
- **Flowchart / process** -> createFlowchart
- **Wireframe / mockup** -> createWireframe
- **Add items inside a frame** -> bulk_create_objects with parentFrameId
- **Find specific objects** -> search_objects
- **Need scoped context (selected/viewport/frame/ids)** -> get_board_context
- **Need full board picture** -> read_board_state (last resort on large boards)

## Working with existing objects (CRITICAL)
When the user asks to organize, categorize, group, sort, separate, reorganize, convert, or rearrange existing objects into a layout:

1. First, call search_objects (or get_board_context/read_board_state if needed) to get the IDs of existing objects.
2. Analyze the objects' text content to determine how they should be categorized or ordered.
3. Call the appropriate layout tool with the \`sourceIds\` parameter, mapping each object ID to the correct branch/column/step.
4. NEVER duplicate existing objects. The sourceIds parameter REPOSITIONS them — it does not create copies.

The sourceIds parameter is available on: createMindMap, createFlowchart, createColumnLayout, and createQuadrant (as quadrantSourceIds).

## Rules
1. Always execute changes via tool calls — never just describe them.
2. After creating objects, connect them with create_connectors using the returned IDs.
3. Keep responses concise — the user sees objects appear in real time.
4. Make reasonable assumptions for ambiguous requests and proceed.
5. Use specialized layout tools (createQuadrant, createColumnLayout, createMindMap, createFlowchart, createWireframe) instead of manually placing frames and stickies.`;

export interface AgentStreamEvent {
  type:
    | "text"
    | "tool_start"
    | "tool_result"
    | "done"
    | "error"
    | "meta"
    | "navigate"
    | "plan_ready"
    | "step_started"
    | "step_succeeded"
    | "step_failed";
  content: string;
}

/**
 * Run the agent loop. Yields streaming events.
 */
interface ViewportInput {
  x: number;
  y: number;
  scale: number;
}

interface ScreenSizeInput {
  width: number;
  height: number;
}

/**
 * Compute the canvas-coordinate bounds of what the user currently sees.
 *
 * Konva stages use a CSS-like transform: the stage's x/y is the translation
 * applied BEFORE scaling, so canvas coords map to screen as:
 *   screenX = canvasX * scale + stageX
 *   screenY = canvasY * scale + stageY
 *
 * Inverting:
 *   canvasX = (screenX - stageX) / scale
 *   canvasY = (screenY - stageY) / scale
 */
export function computeViewBounds(
  viewport: ViewportInput,
  screen: ScreenSizeInput
) {
  const { x: stageX, y: stageY, scale } = viewport;
  const { width: sw, height: sh } = screen;

  const left   = (0  - stageX) / scale;
  const top    = (0  - stageY) / scale;
  const right  = (sw - stageX) / scale;
  const bottom = (sh - stageY) / scale;

  return {
    left:    Math.round(left),
    top:     Math.round(top),
    right:   Math.round(right),
    bottom:  Math.round(bottom),
    centerX: Math.round((left + right)  / 2),
    centerY: Math.round((top  + bottom) / 2),
    width:   Math.round(right - left),
    height:  Math.round(bottom - top),
    zoomPct: Math.round(scale * 100),
  };
}

type BoardContextScope = "full" | "digest";

interface BuiltBoardContext {
  scope: BoardContextScope;
  payload: unknown;
  objectCount: number;
  connectorCount: number;
}

function truncateText(value: unknown, maxLen = 80): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compactObject(obj: any) {
  return {
    id: obj.id,
    type: obj.type,
    text: truncateText(obj.text),
    color: obj.color,
    x: Math.round(toNumber(obj.x)),
    y: Math.round(toNumber(obj.y)),
    width: Math.round(toNumber(obj.width)),
    height: Math.round(toNumber(obj.height)),
    parentFrameId: obj.parentFrameId ?? null,
  };
}

export function buildBoardContext(
  boardState: unknown,
  complexity: "simple" | "complex",
  selectedIds?: string[]
): BuiltBoardContext {
  const state = (boardState ?? {}) as {
    objectCount?: number;
    connectorCount?: number;
    objects?: any[];
    connectors?: any[];
  };

  const objects = Array.isArray(state.objects) ? state.objects : [];
  const connectors = Array.isArray(state.connectors) ? state.connectors : [];
  const objectCount = typeof state.objectCount === "number" ? state.objectCount : objects.length;
  const connectorCount = typeof state.connectorCount === "number" ? state.connectorCount : connectors.length;

  // Keep the full payload for smaller boards where prompt size isn't a concern.
  if (objectCount <= 250) {
    return {
      scope: "full",
      payload: boardState,
      objectCount,
      connectorCount,
    };
  }

  const selectedSet = new Set(selectedIds ?? []);
  const typeCounts: Record<string, number> = {};
  const childCounts: Record<string, number> = {};

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const obj of objects) {
    const type = typeof obj.type === "string" ? obj.type : "unknown";
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;

    if (obj.parentFrameId) {
      childCounts[obj.parentFrameId] = (childCounts[obj.parentFrameId] ?? 0) + 1;
    }

    const x = toNumber(obj.x, NaN);
    const y = toNumber(obj.y, NaN);
    const width = toNumber(obj.width, NaN);
    const height = toNumber(obj.height, NaN);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }
  }

  const frameLimit = complexity === "complex" ? 80 : 40;
  const objectSampleBudget = complexity === "complex" ? 180 : 90;
  const connectorSampleBudget = complexity === "complex" ? 120 : 50;

  const frames = objects
    .filter((obj) => obj.type === "frame")
    .slice(0, frameLimit)
    .map((frame) => ({
      id: frame.id,
      text: truncateText(frame.text),
      x: Math.round(toNumber(frame.x)),
      y: Math.round(toNumber(frame.y)),
      width: Math.round(toNumber(frame.width)),
      height: Math.round(toNumber(frame.height)),
      color: frame.color,
      childCount: childCounts[frame.id] ?? 0,
    }));

  const selectedObjects = objects
    .filter((obj) => selectedSet.has(obj.id))
    .map(compactObject);

  const sampleObjects: any[] = [];
  const pushSample = (obj: any) => {
    if (sampleObjects.length >= objectSampleBudget) return;
    if (selectedSet.has(obj.id)) return;
    if (obj.type === "frame") return;
    sampleObjects.push(compactObject(obj));
  };

  // Prioritise text-bearing objects since they are most likely targets of
  // language commands ("rename", "find the note that says…", etc.).
  for (const obj of objects) {
    if (sampleObjects.length >= objectSampleBudget) break;
    if (typeof obj.text === "string" && obj.text.trim().length > 0) {
      pushSample(obj);
    }
  }
  for (const obj of objects) {
    if (sampleObjects.length >= objectSampleBudget) break;
    pushSample(obj);
  }

  const sampledConnectors = connectors.slice(0, connectorSampleBudget).map((conn) => ({
    id: conn.id,
    fromId: conn.fromId,
    toId: conn.toId,
    style: conn.style,
    color: conn.color ?? null,
  }));

  const bounds =
    Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
      ? {
          minX: Math.round(minX),
          minY: Math.round(minY),
          maxX: Math.round(maxX),
          maxY: Math.round(maxY),
          width: Math.round(maxX - minX),
          height: Math.round(maxY - minY),
        }
      : null;

  return {
    scope: "digest",
    objectCount,
    connectorCount,
    payload: {
      objectCount,
      connectorCount,
      typeCounts,
      bounds,
      frames,
      selectedObjects,
      sampleObjects,
      sampleConnectors: sampledConnectors,
      truncated: {
        objectsOmitted: Math.max(0, objectCount - selectedObjects.length - sampleObjects.length - frames.length),
        connectorsOmitted: Math.max(0, connectorCount - sampledConnectors.length),
      },
      note:
        "Context is intentionally compact for latency. Call get_board_context for scoped retrieval, or read_board_state only when you need exact full board details.",
    },
  };
}

interface ConversationTurn {
  user: string;
  assistant: string;
}

export async function* runAgent(
  boardId: string,
  userId: string,
  userCommand: string,
  openaiApiKey: string,
  // boardState is fetched by the caller (api/ai.ts) in parallel with the
  // board-access check so we don't pay an extra sequential round-trip here.
  boardState: unknown,
  viewport?: ViewportInput,
  screenSize?: ScreenSizeInput,
  conversationHistory?: ConversationTurn[],
  selectedIds?: string[]
): AsyncGenerator<AgentStreamEvent> {
  // Compute viewport bounds once — reused for placement defaults and context block
  const viewBounds = viewport && screenSize ? computeViewBounds(viewport, screenSize) : null;
  const viewportCenter = viewBounds
    ? { x: viewBounds.centerX, y: viewBounds.centerY }
    : undefined;

  // ── Fast paths: bypass general agent loop for well-known templates ──
  // Only try fast paths when there's no conversation history (fresh request)
  // and no selected objects (not a follow-up edit).
  if (!conversationHistory?.length && !selectedIds?.length) {
    for (const fp of FAST_PATHS) {
      const match = userCommand.match(fp.pattern);
      if (match) {
        yield* fp.handler(match, userCommand, boardId, userId, openaiApiKey, {
          screenSize: screenSize ?? undefined,
          selectedIds: selectedIds ?? undefined,
          viewportCenter,
        });
        return;
      }
    }
  }

  // wrapOpenAI automatically traces every LLM call to LangSmith as a child
  // span when LANGSMITH_TRACING=true. It's a no-op when tracing is off.
  const openai = wrapOpenAI(new OpenAI({ apiKey: openaiApiKey }));

  const complexity = classifyComplexity(userCommand);
  const model = complexity === "complex" ? MODEL_COMPLEX : MODEL_SIMPLE;
  const scopedTools = selectToolDefinitions(
    userCommand,
    complexity,
    Boolean(selectedIds?.length)
  );
  const executionPlan = createExecutionPlan({
    command: userCommand,
    complexity,
    selectedCount: selectedIds?.length ?? 0,
    toolNames: scopedTools.map((tool) => tool.function.name),
    hasFastPath: false,
  });
  const planValidation = validateExecutionPlan(executionPlan);
  if (!planValidation.valid) {
    yield {
      type: "error",
      content: `Plan validation failed (${planValidation.code}): ${planValidation.message}`,
    };
    return;
  }

  const boardContext = buildBoardContext(boardState, complexity, selectedIds);
  const boardContextJson = JSON.stringify(boardContext.payload);

  // Let the client know which model/context scope was selected
  yield {
    type: "meta",
    content: JSON.stringify({
      model,
      complexity,
      contextScope: boardContext.scope,
      contextChars: boardContextJson.length,
      boardObjectCount: boardContext.objectCount,
      boardConnectorCount: boardContext.connectorCount,
      toolCount: scopedTools.length,
    }),
  };

  yield {
    type: "plan_ready",
    content: JSON.stringify(executionPlan),
  };

  // Build viewport context block if we have the data
  let viewportContext = "";
  if (viewBounds) {
    const vb = viewBounds;
    viewportContext = `
## User's Current Viewport
The user is currently looking at this region of the canvas (canvas coordinates):
- **Visible area**: left=${vb.left}, top=${vb.top}, right=${vb.right}, bottom=${vb.bottom}
- **View center**: x=${vb.centerX}, y=${vb.centerY}
- **Visible size**: ${vb.width} × ${vb.height} canvas units
- **Zoom level**: ${vb.zoomPct}%

When the user says "here", "my view", "center", "where I'm looking", "visible area",
or similar — use the viewport coordinates above, not (0,0). Place objects inside
the visible area bounds so they appear on screen immediately.

To center a group of objects in the user's view: compute the bounding box of the
group, then offset all positions so the group center lands on (${vb.centerX}, ${vb.centerY}).`;
  }

  // Build prior conversation turns so the agent has memory of what was
  // said and done before — critical for follow-up commands like
  // "do it again" or "no, the other ones".
  const priorMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const turn of conversationHistory ?? []) {
    priorMessages.push({ role: "user",      content: turn.user      });
    priorMessages.push({ role: "assistant", content: turn.assistant  });
  }

  const selectionContext = selectedIds?.length
    ? `\n\n## Currently Selected Objects\nThe user has these object IDs selected: ${selectedIds.join(", ")}.\nWhen the user says "the selected", "these", "them", "those" — they mean these objects.\nTools that accept ids (arrange_objects, duplicate_objects, navigate_to_objects) will default to these if you omit ids.`
    : "";

  const boardContextHeading =
    boardContext.scope === "digest"
      ? "## Current Board State Digest (truncated for speed)"
      : "## Current Board State";

  const digestUsageHint =
    boardContext.scope === "digest"
      ? "\nIf you need details not present in this digest, call get_board_context first (selected/viewport/frame/ids), and use read_board_state only as a last resort."
      : "";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content:
        `${boardContextHeading}\n\`\`\`json\n${boardContextJson}\n\`\`\`${digestUsageHint}` +
        viewportContext +
        selectionContext,
    },
    ...priorMessages,
    { role: "user", content: userCommand },
  ];

  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    try {
      const stream = await openai.chat.completions.create({
        model,
        messages,
        tools: scopedTools,
        tool_choice: "auto",
        stream: true,
        temperature: 0.3,
        // Simple commands rarely need more than a short confirmation;
        // complex/multi-step commands get the full budget.
        max_tokens: complexity === "complex" ? 4096 : 1024,
      });

      // ── Progressive streaming ─────────────────────────────────────
      // We process delta.tool_calls BEFORE delta.content within each chunk
      // so the isToolStep flag is set before we decide whether to emit text.
      //
      // Tool-calling steps: text (pre-narration) is silently dropped — the
      // model rarely narrates before tool calls given the system prompt.
      // Final step (no tool calls): tokens are emitted live as they arrive.
      let assistantContent = "";
      let isToolStep = false;
      const toolCalls: Map<
        number,
        { id: string; name: string; arguments: string }
      > = new Map();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Tool calls first — sets isToolStep before we touch content
        if (delta.tool_calls) {
          isToolStep = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const existing = toolCalls.get(idx);
            if (!existing) {
              toolCalls.set(idx, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            } else {
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments)
                existing.arguments += tc.function.arguments;
            }
          }
        }

        // Stream text live only during the final (non-tool) step
        if (delta.content) {
          assistantContent += delta.content;
          if (!isToolStep) {
            yield { type: "text", content: delta.content };
          }
        }
      }

      // Final step — text was already streamed token-by-token above
      if (!isToolStep) {
        messages.push({ role: "assistant", content: assistantContent });
        yield { type: "done", content: "" };
        return;
      }

      // Build the assistant message with tool calls
      const toolCallEntries = Array.from(toolCalls.values());
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCallEntries.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      messages.push(assistantMsg);

      // Signal tool starts
      for (let i = 0; i < toolCallEntries.length; i++) {
        const tc = toolCallEntries[i];
        yield { type: "tool_start", content: tc.name };
        yield {
          type: "step_started",
          content: JSON.stringify({
            stepId: `iter-${iteration}-tool-${i + 1}`,
            iteration,
            index: i + 1,
            total: toolCallEntries.length,
            tool: tc.name,
          }),
        };
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolCallEntries.map(async (tc) => {
          let args: Record<string, any>;
          try {
            args = JSON.parse(tc.arguments);
          } catch {
            return {
              id: tc.id,
              name: tc.name,
              result: { error: "Failed to parse tool arguments" },
            };
          }

          try {
            const result = await executeTool(tc.name, args, boardId, userId, {
              screenSize: screenSize ?? undefined,
              selectedIds: selectedIds ?? undefined,
              viewportCenter,
            }, openaiApiKey);
            return { id: tc.id, name: tc.name, result };
          } catch (err: any) {
            return {
              id: tc.id,
              name: tc.name,
              result: { error: err.message || "Tool execution failed" },
            };
          }
        })
      );

      // Yield tool results — emit a navigate event if any tool returned _viewport
      for (let i = 0; i < toolResults.length; i++) {
        const tr = toolResults[i];
        const res = tr.result as any;
        if (res?._viewport) {
          yield { type: "navigate", content: JSON.stringify(res._viewport) };
        }
        yield {
          type: "tool_result",
          content: JSON.stringify({ tool: tr.name, result: tr.result }),
        };

        const failed = Boolean(res?.error);
        yield {
          type: failed ? "step_failed" : "step_succeeded",
          content: JSON.stringify({
            stepId: `iter-${iteration}-tool-${i + 1}`,
            iteration,
            index: i + 1,
            total: toolResults.length,
            tool: tr.name,
            ...(failed ? { error: String(res.error) } : {}),
          }),
        };
      }

      // Add tool results to conversation history
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.id,
          content: JSON.stringify(tr.result),
        });
      }

      // Continue the loop — the LLM will see tool results and decide next action
    } catch (err: any) {
      yield { type: "error", content: err.message || "Agent error" };
      return;
    }
  }

  // Hit max iterations
  yield {
    type: "text",
    content: "\n\n(Reached maximum iterations. Some tasks may be incomplete.)",
  };
  yield { type: "done", content: "" };
}
