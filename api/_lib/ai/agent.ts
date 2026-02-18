import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { TOOL_DEFINITIONS } from "./toolSchemas.js";
import * as tools from "./tools.js";
import {
  getBoardStateForAI,
  type Viewport,
  type CompactObject,
} from "../boardState.js";
import { routeCommand, type RouteResult } from "./router.js";
import { buildBoardDigest } from "./digest.js";
import {
  getTemplate,
  generateTemplateContent,
  executeTemplate,
} from "./templates.js";
import { generatePlan, validatePlan, executePlan, type Plan } from "./planner.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

// ─── Guardrails ───────────────────────────────────────────────

const MAX_ITERATIONS = 6;
const MAX_TOOL_CALLS = 50;
const MAX_OBJECTS_CREATED = 200;
const OPENAI_TIMEOUT_MS = 45_000;

// ─── Result Type ──────────────────────────────────────────────

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

// ─── Main Entry Point ─────────────────────────────────────────

export async function executeAICommand(
  command: string,
  boardId: string,
  uid: string,
  viewport: Viewport,
  selectedIds: string[],
  openaiApiKey: string,
  commandId?: string
): Promise<AIExecutionResult> {
  const startTime = Date.now();

  // Load board state
  const boardObjects = await getBoardStateForAI(boardId, viewport, selectedIds);

  // Extract existing frame titles for smart template routing
  const existingFrameTitles = boardObjects
    .filter((o) => o.type === "frame" && o.text)
    .map((o) => o.text!.toLowerCase().trim());

  // Route the command
  const route = routeCommand(
    command,
    selectedIds.length,
    boardObjects.length,
    existingFrameTitles
  );

  // Tool context
  const ctx: tools.ToolContext = {
    boardId,
    uid,
    viewport,
    existingObjects: [...boardObjects],
  };

  // Progress helper: update ai_runs if we have a commandId
  const updateProgress = async (status: string, step?: string) => {
    if (!commandId) return;
    try {
      const supabase = getSupabaseAdmin();
      await supabase
        .from("ai_runs")
        .update({
          status,
          response: step ? { progress: step } : undefined,
        })
        .eq("board_id", boardId)
        .eq("command_id", commandId);
    } catch {
      /* non-critical */
    }
  };

  // ── Route to the appropriate execution path ──

  // Path 1: Deterministic template (Phase 2)
  if (route.intent === "create_template" && route.templateId) {
    return executeTemplatePath(
      command,
      route,
      ctx,
      viewport,
      boardObjects,
      openaiApiKey,
      startTime,
      updateProgress
    );
  }

  // Path 2: Plan → Execute for reorganize (Phase 3)
  if (route.intent === "reorganize") {
    return executePlannerPath(
      command,
      route,
      ctx,
      viewport,
      boardObjects,
      selectedIds,
      openaiApiKey,
      startTime,
      updateProgress
    );
  }

  // Path 3: General tool-calling loop (existing behavior, optimized)
  return executeToolLoop(
    command,
    route,
    ctx,
    viewport,
    boardObjects,
    selectedIds,
    openaiApiKey,
    startTime,
    updateProgress
  );
}

// ─── Path 1: Template Execution ──────────────────────────────

async function executeTemplatePath(
  command: string,
  route: RouteResult,
  ctx: tools.ToolContext,
  viewport: Viewport,
  boardObjects: CompactObject[],
  openaiApiKey: string,
  startTime: number,
  updateProgress: (status: string, step?: string) => Promise<void>
): Promise<AIExecutionResult> {
  const template = getTemplate(route.templateId!);

  if (!template) {
    // Fallback to general loop if template not found
    return executeToolLoop(
      command,
      { ...route, intent: "create_simple" },
      ctx,
      viewport,
      boardObjects,
      [],
      openaiApiKey,
      startTime,
      updateProgress
    );
  }

  await updateProgress("executing", "Generating content...");

  // Small, fast LLM call for content only
  const content = await generateTemplateContent(command, template, openaiApiKey);

  await updateProgress("executing", "Creating template layout...");

  // Deterministic layout execution — no LLM needed
  const result = await executeTemplate(template, content, ctx, viewport);

  const durationMs = Date.now() - startTime;

  return {
    success: result.success,
    message: result.success
      ? `Created ${template.name}: ${result.createdIds.length} objects (${result.frameIds.length} frames)`
      : `Template error: ${result.error}`,
    objectsCreated: result.createdIds,
    objectsUpdated: [],
    objectsDeleted: [],
    focus: computeFocusBounds(result.createdIds, ctx.existingObjects),
    model: "gpt-4o-mini",
    inputTokens: 0, // Content gen tokens aren't tracked here
    outputTokens: 0,
    totalTokens: 0,
    toolCallsCount: 0,
    durationMs,
  };
}

// ─── Path 2: Plan → Execute ──────────────────────────────────

async function executePlannerPath(
  command: string,
  route: RouteResult,
  ctx: tools.ToolContext,
  viewport: Viewport,
  boardObjects: CompactObject[],
  selectedIds: string[],
  openaiApiKey: string,
  startTime: number,
  updateProgress: (status: string, step?: string) => Promise<void>
): Promise<AIExecutionResult> {
  try {
    await updateProgress("planning", "Analyzing board and creating plan...");

    // Phase 3: Generate structured plan (one LLM call, no tools)
    const plan = await withTimeout<Plan>(
      generatePlan(command, boardObjects, viewport, selectedIds, openaiApiKey),
      30_000,
      "Plan generation timed out"
    );

    // Validate
    const validation = validatePlan(plan, boardObjects.length);
    if (!validation.ok) {
      // Fall back to general tool loop on validation failure
      return executeToolLoop(
        command,
        route,
        ctx,
        viewport,
        boardObjects,
        selectedIds,
        openaiApiKey,
        startTime,
        updateProgress
      );
    }

    await updateProgress("executing", "Executing plan...");

    // Execute deterministically
    const result = await executePlan(plan, ctx, viewport, (step, total, label) => {
      updateProgress("executing", `Step ${step}/${total}: ${label}`);
    });

    const durationMs = Date.now() - startTime;

    const allCreated = result.createdIds;
    const allUpdated = result.updatedIds;
    const allDeleted = result.deletedIds;

    return {
      success: result.success,
      message: result.success
        ? buildSummary(allCreated, allUpdated, allDeleted) +
          (plan.summary ? ` (${plan.summary})` : "")
        : `Plan execution error: ${result.error}`,
      objectsCreated: allCreated,
      objectsUpdated: allUpdated,
      objectsDeleted: allDeleted,
      focus: computeFocusBounds(allCreated, ctx.existingObjects),
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      toolCallsCount: 0,
      durationMs,
    };
  } catch (error) {
    // If planner fails, fall back to general tool loop
    return executeToolLoop(
      command,
      route,
      ctx,
      viewport,
      boardObjects,
      selectedIds,
      openaiApiKey,
      startTime,
      updateProgress
    );
  }
}

// ─── Path 3: General Tool-Calling Loop ───────────────────────

async function executeToolLoop(
  command: string,
  route: RouteResult,
  ctx: tools.ToolContext,
  viewport: Viewport,
  boardObjects: CompactObject[],
  selectedIds: string[],
  openaiApiKey: string,
  startTime: number,
  updateProgress: (status: string, step?: string) => Promise<void>
): Promise<AIExecutionResult> {
  const model = route.model;
  const toolDefs = selectTools(route);
  let inputTokens = 0;
  let outputTokens = 0;
  let totalToolCalls = 0;

  const openai = new OpenAI({ apiKey: openaiApiKey });

  const systemPrompt = buildSystemPrompt(viewport, selectedIds, boardObjects, route);
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: command },
  ];

  const objectsCreated: string[] = [];
  const objectsUpdated: string[] = [];
  const objectsDeleted: string[] = [];

  await updateProgress("executing", "Processing...");

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (totalToolCalls >= MAX_TOOL_CALLS) break;
    if (objectsCreated.length >= MAX_OBJECTS_CREATED) break;

    const response = await withTimeout(
      openai.chat.completions.create({
        model,
        messages,
        tools: toolDefs,
        tool_choice: iteration === 0 ? "required" : "auto",
      }),
      OPENAI_TIMEOUT_MS,
      "OpenAI call timed out"
    );

    if (response.usage) {
      inputTokens += response.usage.prompt_tokens;
      outputTokens += response.usage.completion_tokens;
    }

    const choice = response.choices[0];
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      const durationMs = Date.now() - startTime;
      return {
        success: true,
        message:
          choice.message.content ||
          buildSummary(objectsCreated, objectsUpdated, objectsDeleted),
        objectsCreated,
        objectsUpdated,
        objectsDeleted,
        focus: computeFocusBounds(objectsCreated, ctx.existingObjects),
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        toolCallsCount: totalToolCalls,
        durationMs,
      };
    }

    messages.push(choice.message as ChatCompletionMessageParam);

    const callsToExecute = choice.message.tool_calls.slice(
      0,
      MAX_TOOL_CALLS - totalToolCalls
    );

    for (const toolCall of callsToExecute) {
      totalToolCalls++;
      let result: any;

      const fn = "function" in toolCall ? toolCall.function : null;
      if (!fn) {
        result = { success: false, error: "Unsupported tool call type" };
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
        continue;
      }

      try {
        const args = JSON.parse(fn.arguments);
        result = await executeToolCall(fn.name, args, ctx, selectedIds);

        // Track results
        if (result?.objectId) {
          const createTools = [
            "createStickyNote",
            "createShape",
            "createFrame",
            "createConnector",
          ];
          if (createTools.includes(fn.name)) {
            objectsCreated.push(result.objectId);
          } else {
            objectsUpdated.push(result.objectId);
          }
        }
        if (result?.data?.createdIds && Array.isArray(result.data.createdIds)) {
          objectsCreated.push(...result.data.createdIds);
        }
        if (result?.data?.updatedIds && Array.isArray(result.data.updatedIds)) {
          objectsUpdated.push(...result.data.updatedIds);
        }
        if (result?.data?.deletedIds && Array.isArray(result.data.deletedIds)) {
          objectsDeleted.push(...result.data.deletedIds);
        }
        if (result?.data?.deletedCount && !result?.data?.deletedIds) {
          objectsDeleted.push(`all (${result.data.deletedCount})`);
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

    await updateProgress(
      "executing",
      `Iteration ${iteration + 1}: ${objectsCreated.length} created, ${objectsUpdated.length} updated`
    );
  }

  const durationMs = Date.now() - startTime;
  return {
    success: true,
    message: buildSummary(objectsCreated, objectsUpdated, objectsDeleted),
    objectsCreated,
    objectsUpdated,
    objectsDeleted,
    focus: computeFocusBounds(objectsCreated, ctx.existingObjects),
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    toolCallsCount: totalToolCalls,
    durationMs,
  };
}

// ─── System Prompt Builder ────────────────────────────────────

function buildSystemPrompt(
  viewport: Viewport,
  selectedIds: string[],
  boardObjects: CompactObject[],
  route: RouteResult
): string {
  const digest = buildBoardDigest(boardObjects, {
    selectedIds,
    viewport,
    scope: route.scope,
    includeFullObjects: route.needsFullContext,
    maxDetailObjects: 50,
  });

  const selectionInfo =
    selectedIds.length > 0
      ? `\nSelected objects: ${selectedIds.join(", ")}`
      : "\nNo objects selected.";

  let prompt = `You are an AI assistant that manipulates a collaborative whiteboard.

## Viewport
  Center: (${Math.round(viewport.centerX)}, ${Math.round(viewport.centerY)})
  Zoom: ${viewport.scale.toFixed(2)}x
${selectionInfo}

## Placement Rules — IMPORTANT
**You do NOT need to compute x/y coordinates.** The server handles layout:
- **Inside frames**: Pass \`parentFrameId\` — omit x/y. Grid layout is automatic.
- **Free objects**: Omit x/y — auto-placed in a clean grid near viewport center.
- **Only specify x/y** for frame positioning in templates.

## Colors
yellow (#FBBF24), pink (#F472B6), blue (#3B82F6), green (#22C55E), orange (#F97316), purple (#A855F7), red (#EF4444), gray (#9CA3AF), white (#FFFFFF)
Color can be a hex code or "random" for a random palette color.
`;

  // Intent-specific guidance (keep it short — fewer tokens)
  switch (route.intent) {
    case "create_template":
      prompt += `\n## Template\n1. Create frames with \`expectedChildCount\` + explicit x/y\n2. \`bulkCreate\` stickies with \`parentFrameId\`\n3. Space frames 30px apart\n`;
      break;
    case "create_simple":
      prompt += `\n## Creating\nUse \`bulkCreate\` for 3+ objects. Individual tools for 1-2.\n`;
      break;
    case "delete":
      prompt += `\n## Deleting\nUse \`bulkDelete\`: mode "all"/"by_type"/"by_ids".\n`;
      break;
    case "edit_selected":
      prompt += `\n## Editing\nApply changes to selected objects.\n`;
      break;
    case "edit_specific":
      prompt += `\n## Targeted edits\nPrefer modifying existing objects/frames mentioned by name.\nUse \`getBoardContext\` first to resolve IDs before creating new objects.\n`;
      break;
    default:
      prompt += `\n## Tools\n- \`bulkCreate\`/\`bulkDelete\` for batch ops\n- \`arrangeObjects\`/\`rearrangeFrame\` for layout\n- \`getBoardContext\` for details\n`;
  }

  prompt += `\nAlways respond with tool calls.\n\n## Board State\n${digest}`;
  return prompt;
}

// ─── Dynamic Tool Selection ──────────────────────────────────

function selectTools(route: RouteResult): ChatCompletionTool[] {
  if (!route.allowedTools) return TOOL_DEFINITIONS;
  const allowed = new Set(route.allowedTools);
  allowed.add("getBoardContext"); // always available as escape hatch
  return TOOL_DEFINITIONS.filter((t) => {
    const name = "function" in t ? t.function?.name : undefined;
    return name && allowed.has(name);
  });
}

// ─── Tool Dispatch ────────────────────────────────────────────

async function executeToolCall(
  name: string,
  args: Record<string, any>,
  ctx: tools.ToolContext,
  selectedIds: string[]
): Promise<any> {
  switch (name) {
    case "createStickyNote":
      return tools.createStickyNote(ctx, args.text, args.x, args.y, args.color, args.parentFrameId);
    case "createShape":
      return tools.createShape(ctx, args.type, args.x, args.y, args.width, args.height, args.color, args.parentFrameId, args.x2, args.y2);
    case "createFrame":
      return tools.createFrame(ctx, args.title, args.x, args.y, args.width, args.height, args.expectedChildCount);
    case "addObjectToFrame":
      return tools.addObjectToFrame(ctx, args.objectId, args.frameId);
    case "removeObjectFromFrame":
      return tools.removeObjectFromFrame(ctx, args.objectId);
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
    case "bulkDelete":
      return tools.bulkDelete(ctx, args.mode, args.objectIds, args.objectType);
    case "bulkCreate":
      return tools.bulkCreate(ctx, args.items);
    case "arrangeObjects":
      return tools.arrangeObjects(ctx, args.objectIds, args.layout, args.spacing);
    case "rearrangeFrame":
      return tools.rearrangeFrame(ctx, args.frameId);
    case "getBoardContext":
      return tools.getBoardContext(ctx, args.scope, selectedIds, args.frameId, args.objectIds, args.typeFilter);
    case "getBoardState":
      return tools.getBoardContext(ctx, "all");
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function buildSummary(created: string[], updated: string[], deleted?: string[]): string {
  const parts: string[] = [];
  if (created.length > 0) parts.push(`${created.length} object(s) created`);
  if (updated.length > 0) parts.push(`${updated.length} object(s) updated`);
  if (deleted && deleted.length > 0) parts.push(`${deleted.length} object(s) deleted`);
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

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of created) {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.width);
    maxY = Math.max(maxY, obj.y + obj.height);
  }
  return { minX, minY, maxX, maxY };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
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
