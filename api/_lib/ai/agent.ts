import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { TOOL_DEFINITIONS } from "./toolSchemas";
import * as tools from "./tools";
import { getBoardStateForAI, type Viewport, type CompactObject } from "../boardState";

// ─── Guardrails ───────────────────────────────────────────────

const MAX_ITERATIONS = 5;
const MAX_TOOL_CALLS = 25;
const MAX_OBJECTS_CREATED = 25;
const OPENAI_TIMEOUT_MS = 25_000;

// ─── Model Selection ──────────────────────────────────────────

const COMPLEX_KEYWORDS = [
  "swot", "retrospective", "retro", "journey map", "kanban",
  "template", "workflow", "brainstorm", "mind map", "roadmap",
  "user story", "sprint", "standup", "agile", "matrix",
];

function selectModel(command: string): string {
  const lower = command.toLowerCase();
  return COMPLEX_KEYWORDS.some((kw) => lower.includes(kw)) ? "gpt-4o" : "gpt-4o-mini";
}

// ─── System Prompt Builder ────────────────────────────────────

function buildSystemPrompt(
  viewport: Viewport,
  selectedIds: string[],
  boardObjects: CompactObject[]
): string {
  const objectsSummary =
    boardObjects.length > 0
      ? `\n\nCurrent board objects (${boardObjects.length} visible):\n${JSON.stringify(
          boardObjects.map((o) => ({
            id: o.id,
            type: o.type,
            x: Math.round(o.x),
            y: Math.round(o.y),
            width: Math.round(o.width),
            height: Math.round(o.height),
            color: o.color,
            text: o.text,
            parentFrameId: o.parentFrameId,
          })),
          null,
          2
        )}`
      : "\n\nThe board is currently empty.";

  const selectionInfo =
    selectedIds.length > 0
      ? `\nSelected objects: ${selectedIds.join(", ")}`
      : "\nNo objects selected.";

  return `You are an AI assistant that manipulates a collaborative whiteboard. You have tools for creating and manipulating board objects.

Current board state and the user's viewport are provided as context. Use them to:
- Understand existing objects when the user references them (e.g., "move the pink stickies")
- Place new objects within or near the user's current view
- Avoid overlapping existing objects (the system will adjust placement automatically)

The user's viewport in canvas coordinates:
  Top-left: (${Math.round(viewport.minX)}, ${Math.round(viewport.minY)})
  Bottom-right: (${Math.round(viewport.maxX)}, ${Math.round(viewport.maxY)})
  Center: (${Math.round(viewport.centerX)}, ${Math.round(viewport.centerY)})
  Zoom: ${viewport.scale.toFixed(2)}x
${selectionInfo}

For complex commands (SWOT, retro, journey map), plan tool calls to create a well-organized layout centered near (${Math.round(viewport.centerX)}, ${Math.round(viewport.centerY)}). Use consistent spacing (220px between objects, 300px between frames).

Available colors: yellow (#FBBF24), pink (#F472B6), blue (#3B82F6), green (#22C55E), orange (#F97316), purple (#A855F7), red (#EF4444), gray (#9CA3AF), white (#FFFFFF).

Always respond with tool calls. Do not respond with text-only messages unless you cannot fulfill the request.${objectsSummary}`;
}

// ─── Execution ────────────────────────────────────────────────

export interface AIExecutionResult {
  success: boolean;
  message: string;
  objectsCreated: string[];
  objectsUpdated: string[];
  objectsDeleted: string[];
  focus?: { minX: number; minY: number; maxX: number; maxY: number };
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallsCount: number;
  durationMs: number;
}

export async function executeAICommand(
  command: string,
  boardId: string,
  uid: string,
  viewport: Viewport,
  selectedIds: string[],
  openaiApiKey: string
): Promise<AIExecutionResult> {
  const startTime = Date.now();
  const model = selectModel(command);
  let inputTokens = 0;
  let outputTokens = 0;
  let totalToolCalls = 0;

  const openai = new OpenAI({ apiKey: openaiApiKey });

  // Load scoped board state
  const boardObjects = await getBoardStateForAI(boardId, viewport, selectedIds);

  // Tool context (shared, mutable — tracks created objects for placement)
  const ctx: tools.ToolContext = {
    boardId,
    uid,
    viewport,
    existingObjects: [...boardObjects],
  };

  const systemPrompt = buildSystemPrompt(viewport, selectedIds, boardObjects);
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: command },
  ];

  const objectsCreated: string[] = [];
  const objectsUpdated: string[] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (totalToolCalls >= MAX_TOOL_CALLS) break;
    if (objectsCreated.length >= MAX_OBJECTS_CREATED) break;

    // Call OpenAI with timeout
    const response = await withTimeout(
      openai.chat.completions.create({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: iteration === 0 ? "required" : "auto",
      }),
      OPENAI_TIMEOUT_MS,
      "OpenAI call timed out"
    );

    // Track token usage
    if (response.usage) {
      inputTokens += response.usage.prompt_tokens;
      outputTokens += response.usage.completion_tokens;
    }

    const choice = response.choices[0];
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      // No more tool calls — done
      const durationMs = Date.now() - startTime;
      return {
        success: true,
        message: choice.message.content || buildSummary(objectsCreated, objectsUpdated),
        objectsCreated,
        objectsUpdated,
        objectsDeleted: [],
        focus: computeFocusBounds(objectsCreated, ctx.existingObjects),
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        toolCallsCount: totalToolCalls,
        durationMs,
      };
    }

    // Add assistant message
    messages.push(choice.message as ChatCompletionMessageParam);

    // Execute tool calls (capped)
    const callsToExecute = choice.message.tool_calls.slice(
      0,
      MAX_TOOL_CALLS - totalToolCalls
    );

    for (const toolCall of callsToExecute) {
      totalToolCalls++;
      let result: any;

      try {
        const args = JSON.parse(toolCall.function.arguments);
        result = await executeToolCall(toolCall.function.name, args, ctx, boardObjects);

        if (result?.objectId) {
          if (["createStickyNote", "createShape", "createFrame", "createConnector"].includes(toolCall.function.name)) {
            objectsCreated.push(result.objectId);
          } else {
            objectsUpdated.push(result.objectId);
          }
        }
      } catch (err) {
        result = { success: false, error: String(err) };
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  const durationMs = Date.now() - startTime;
  return {
    success: true,
    message: buildSummary(objectsCreated, objectsUpdated),
    objectsCreated,
    objectsUpdated,
    objectsDeleted: [],
    focus: computeFocusBounds(objectsCreated, ctx.existingObjects),
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    toolCallsCount: totalToolCalls,
    durationMs,
  };
}

// ─── Tool Dispatch ────────────────────────────────────────────

// Re-export ToolContext type for tools.ts
export type { ToolContext } from "./tools";

async function executeToolCall(
  name: string,
  args: Record<string, any>,
  ctx: tools.ToolContext,
  boardObjects: CompactObject[]
): Promise<any> {
  switch (name) {
    case "createStickyNote":
      return tools.createStickyNote(ctx, args.text, args.x, args.y, args.color);
    case "createShape":
      return tools.createShape(ctx, args.type, args.x, args.y, args.width, args.height, args.color);
    case "createFrame":
      return tools.createFrame(ctx, args.title, args.x, args.y, args.width, args.height);
    case "createConnector":
      return tools.createConnector(ctx, args.fromId, args.toId, args.style);
    case "moveObject":
      return tools.moveObject(ctx, args.objectId, args.x, args.y);
    case "resizeObject":
      return tools.resizeObject(ctx, args.objectId, args.width, args.height);
    case "updateText":
      return tools.updateText(ctx, args.objectId, args.newText);
    case "changeColor":
      return tools.changeColor(ctx, args.objectId, args.color);
    case "getBoardState":
      // Return the already-loaded board state
      return boardObjects;
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function buildSummary(created: string[], updated: string[]): string {
  const parts: string[] = [];
  if (created.length > 0) parts.push(`${created.length} object(s) created`);
  if (updated.length > 0) parts.push(`${updated.length} object(s) updated`);
  return parts.length > 0 ? `Done! ${parts.join(", ")}.` : "Command completed.";
}

function computeFocusBounds(
  createdIds: string[],
  allObjects: CompactObject[]
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  if (createdIds.length === 0) return undefined;

  const createdSet = new Set(createdIds);
  const created = allObjects.filter((o) => createdSet.has(o.id));
  if (created.length === 0) return undefined;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const obj of created) {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.width);
    maxY = Math.max(maxY, obj.y + obj.height);
  }

  return { minX, minY, maxX, maxY };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}
