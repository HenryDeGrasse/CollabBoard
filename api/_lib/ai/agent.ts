import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { traceable, getCurrentRunTree } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
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
import { decideIntentRoute, parseFastPath, type FastPathMatch, type RouteSource } from "./intentEngine.js";
import { recordRouteLatency } from "./runtimeMetrics.js";
import {
  getBoardVersion,
  incrementBoardVersion,
  updateJobProgress,
  loadJob,
} from "./versioning.js";

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
  routeSource?: RouteSource;
  routeConfidence?: number;
  routeReason?: string;
}

// ─── Main Entry Point ─────────────────────────────────────────

export const executeAICommand = traceable(async function executeAICommand(
  command: string,
  boardId: string,
  uid: string,
  viewport: Viewport,
  selectedIds: string[],
  openaiApiKey: string,
  commandId?: string
): Promise<AIExecutionResult> {
  const startTime = Date.now();

  // ── Parallel: load board state, version, and job check concurrently ──
  const [boardObjects, boardVersionStart, existingJob] = await Promise.all([
    getBoardStateForAI(boardId, viewport, selectedIds),
    getBoardVersion(boardId).catch(() => 0),
    commandId ? loadJob(boardId, commandId).catch(() => null) : Promise.resolve(null),
  ]);

  // ── Resumable: short-circuit if already completed ──
  if (existingJob && existingJob.status === "completed") {
    return {
      success: true,
      message: "Command already completed (idempotent).",
      objectsCreated: [],
      objectsUpdated: [],
      objectsDeleted: [],
      model: "cached",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      toolCallsCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

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

  // Intent engine chooses route source + confidence.
  const initialDecision = decideIntentRoute(command, route.intent);
  let routeSource: RouteSource = initialDecision.source;
  let routeConfidence = initialDecision.confidence;
  let routeReason = initialDecision.reason;

  // Tag the LangSmith trace with routing metadata for filtering
  try {
    const runTree = getCurrentRunTree();
    if (runTree) {
      runTree.extra = {
        ...runTree.extra,
        metadata: {
          ...(runTree.extra?.metadata ?? {}),
          intent: route.intent,
          model: route.model,
          boardId,
          boardObjectCount: boardObjects.length,
          selectedCount: selectedIds.length,
          templateId: route.templateId,
          toolCount: route.allowedTools?.length ?? "all",
          routeSource,
          routeConfidence,
          routeReason,
        },
      };
    }
  } catch {
    /* non-critical */
  }

  // Tool context
  const ctx: tools.ToolContext = {
    boardId,
    uid,
    viewport,
    existingObjects: [...boardObjects],
  };

  // Progress helper: update ai_runs if we have a commandId
  const updateProgress = async (status: string, step?: string, currentStep?: number) => {
    if (!commandId) return;
    try {
      await updateJobProgress(boardId, commandId, {
        status,
        currentStep,
        boardVersionStart,
        response: step ? { progress: step } : undefined,
      });
    } catch {
      /* non-critical */
    }
  };

  // ── Route to the appropriate execution path ──
  // Wrap all paths: on success, bump board version + record completion.

  let result: AIExecutionResult;

  // Path 0: Intent engine route sources
  let fastPathResult: AIExecutionResult | null = null;

  if (routeSource === "fast_path") {
    fastPathResult = await tryExecuteFastPath(
      route,
      ctx,
      boardObjects,
      startTime,
      updateProgress,
      initialDecision.match
    );
    if (!fastPathResult) {
      // Deterministic execution failed unexpectedly → fallback
      routeSource = "full_agent";
      routeConfidence = 0.2;
      routeReason = `fast_path_failed:${routeReason}`;
    }
  } else if (routeSource === "ai_extractor") {
    const extracted = await tryExtractFastPathWithAI(command, openaiApiKey);
    if (extracted.match && extracted.confidence >= 0.8) {
      fastPathResult = await tryExecuteFastPath(
        route,
        ctx,
        boardObjects,
        startTime,
        updateProgress,
        extracted.match
      );
      if (fastPathResult) {
        routeConfidence = extracted.confidence;
        routeReason = extracted.reason;
      } else {
        routeSource = "full_agent";
        routeConfidence = 0.2;
        routeReason = `ai_extractor_exec_failed:${extracted.reason}`;
      }
    } else {
      routeSource = "full_agent";
      routeConfidence = extracted.confidence;
      routeReason = `ai_extractor_no_match:${extracted.reason}`;
    }
  }

  if (fastPathResult) {
    result = fastPathResult;
  } else if (route.intent === "create_template" && route.templateId) {
    // Path 1: Deterministic template (Phase 2)
    result = await executeTemplatePath(
      command,
      route,
      ctx,
      viewport,
      boardObjects,
      openaiApiKey,
      startTime,
      updateProgress
    );
  } else if (route.intent === "reorganize") {
    // Path 2: Plan → Execute for reorganize (Phase 3)
    result = await executePlannerPath(
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
  } else {
    // Path 3: General tool-calling loop (existing behavior, optimized)
    result = await executeToolLoop(
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

  // ── Post-execution: bump board version on success ──
  if (result.success && (result.objectsCreated.length > 0 || result.objectsUpdated.length > 0 || result.objectsDeleted.length > 0)) {
    try {
      const boardVersionEnd = await incrementBoardVersion(boardId);
      if (commandId) {
        await updateJobProgress(boardId, commandId, {
          status: "completed",
          boardVersionEnd,
        });
      }
    } catch {
      /* non-critical: version bump is best-effort */
    }
  }

  // Attach route diagnostics to result payload/logs
  result.routeSource = routeSource;
  result.routeConfidence = routeConfidence;
  result.routeReason = routeReason;

  // Update trace metadata with final route decision (after fallbacks)
  try {
    const runTree = getCurrentRunTree();
    if (runTree) {
      runTree.extra = {
        ...runTree.extra,
        metadata: {
          ...(runTree.extra?.metadata ?? {}),
          routeSource,
          routeConfidence,
          routeReason,
        },
      };
    }
  } catch {
    /* non-critical */
  }

  // Track latency percentiles by route source and intent (in-memory window)
  recordRouteLatency({
    source: routeSource,
    intent: route.intent,
    durationMs: result.durationMs,
  });

  return result;
}, { name: "executeAICommand", metadata: { service: "collabboard-ai" } });

// ─── Path 1: Template Execution ──────────────────────────────

const executeTemplatePath = traceable(async function executeTemplatePath(
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
}, { name: "executeTemplatePath" });

// ─── Path 2: Plan → Execute ──────────────────────────────────

const executePlannerPath = traceable(async function executePlannerPath(
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
}, { name: "executePlannerPath" });

// ─── Path 3: General Tool-Calling Loop ───────────────────────

const executeToolLoop = traceable(async function executeToolLoop(
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

  const openai = wrapOpenAI(new OpenAI({ apiKey: openaiApiKey }));

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

    // For query intent, don't force tool calls — the model can answer directly
    const forceTools = iteration === 0 && route.intent !== "query";

    const response = await withTimeout(
      openai.chat.completions.create({
        model,
        messages,
        tools: toolDefs,
        tool_choice: forceTools ? "required" : "auto",
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

    const trackToolResult = (toolName: string, result: any) => {
      if (result?.objectId) {
        const createTools = [
          "createStickyNote",
          "createShape",
          "createFrame",
          "createConnector",
        ];
        if (createTools.includes(toolName)) {
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
    };

    const PARALLEL_SAFE_TOOLS = new Set([
      "moveObject",
      "resizeObject",
      "updateText",
      "changeColor",
    ]);

    const parsedCalls = callsToExecute.map((toolCall) => {
      const fn = "function" in toolCall ? toolCall.function : null;
      return { toolCall, fn };
    });

    const canRunInParallel =
      parsedCalls.length > 1 &&
      parsedCalls.every(({ fn }) => fn && PARALLEL_SAFE_TOOLS.has(fn.name));

    if (canRunInParallel) {
      totalToolCalls += parsedCalls.length;
      const results = await Promise.all(
        parsedCalls.map(async ({ toolCall, fn }) => {
          if (!fn) {
            return {
              toolCall,
              toolName: "unknown",
              result: { success: false, error: "Unsupported tool call type" },
            };
          }
          try {
            const args = JSON.parse(fn.arguments);
            const result = await executeToolCall(fn.name, args, ctx, selectedIds);
            return { toolCall, toolName: fn.name, result };
          } catch (err) {
            return {
              toolCall,
              toolName: fn.name,
              result: { success: false, error: String(err) },
            };
          }
        })
      );

      // Preserve tool message ordering as provided by the model
      for (const { toolCall, toolName, result } of results) {
        trackToolResult(toolName, result);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    } else {
      for (const { toolCall, fn } of parsedCalls) {
        totalToolCalls++;
        let result: any;

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
          trackToolResult(fn.name, result);
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

    await updateProgress(
      "executing",
      `Iteration ${iteration + 1}: ${objectsCreated.length} created, ${objectsUpdated.length} updated`
    );

    // ── Early exit: skip the 2nd LLM round-trip for simple intents ──
    // For create_simple and delete, one iteration is enough if all tools
    // succeeded. The 2nd call just generates a summary message we can
    // build programmatically — saves ~1.5s of OpenAI latency.
    const simpleIntents: string[] = ["create_simple", "delete", "edit_specific", "edit_selected"];
    if (
      iteration === 0 &&
      simpleIntents.includes(route.intent) &&
      (objectsCreated.length > 0 || objectsDeleted.length > 0)
    ) {
      // Check that no tool call failed
      const allSucceeded = messages
        .filter((m): m is ChatCompletionMessageParam & { role: "tool" } => m.role === "tool")
        .every((m) => {
          try {
            const parsed = JSON.parse(typeof m.content === "string" ? m.content : "{}");
            return parsed.success !== false;
          } catch { return true; }
        });

      if (allSucceeded) {
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
    }
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
}, { name: "executeToolLoop" });

// ─── System Prompt Builder ────────────────────────────────────

function buildSystemPrompt(
  viewport: Viewport,
  selectedIds: string[],
  boardObjects: CompactObject[],
  route: RouteResult
): string {
  // Query intent: show frame summaries but cap individual objects to save tokens.
  // The model can use getBoardContext to drill deeper if needed.
  const maxDetail = route.intent === "query" ? 20 : 50;

  const digest = buildBoardDigest(boardObjects, {
    selectedIds,
    viewport,
    scope: route.scope,
    includeFullObjects: route.needsFullContext,
    maxDetailObjects: maxDetail,
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
- **Only place objects inside frames when the user explicitly asks** (e.g. "add to the Strengths frame"). Otherwise create free-standing objects.

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
      prompt += `\n## Creating\n**IMPORTANT: Always use \`bulkCreate\` when creating 2+ objects.** Do NOT call createStickyNote/createShape multiple times — use one \`bulkCreate\` call with all items.\nOnly place objects inside frames (via parentFrameId) when the user explicitly asks. Otherwise create free-standing objects.\n`;
      break;
    case "delete":
      prompt += `\n## Deleting\nUse \`bulkDelete\`: mode "all"/"by_type"/"by_ids".\n`;
      break;
    case "edit_selected":
      prompt += `\n## Editing\nApply changes to selected objects.\n`;
      break;
    case "edit_specific":
      prompt += `\n## Targeted edits\nPrefer modifying existing objects/frames mentioned by name.\nFrame IDs are listed in the board state below — use them directly, no need to call getBoardContext first.\n`;
      break;
    case "query":
      prompt += `\n## Answering questions\nAnswer from the board state summary below. Only call \`getBoardContext\` if the user asks about specific object details not in the summary. You may respond with just text (no tool calls needed).\n`;
      break;
    default:
      prompt += `\n## Tools\n- \`bulkCreate\`/\`bulkDelete\` for batch ops\n- \`arrangeObjects\`/\`rearrangeFrame\` for layout\n- \`getBoardContext\` for details\n`;
  }

  prompt += `\nAlways respond with tool calls unless answering a question.\n\n## Board State\n${digest}`;
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

// ─── Fast Path (deterministic, no LLM) ───────────────────────

const COLOR_MAP: Record<string, string> = {
  yellow: "#FBBF24",
  pink: "#F472B6",
  blue: "#3B82F6",
  green: "#22C55E",
  orange: "#F97316",
  purple: "#A855F7",
  red: "#EF4444",
  gray: "#9CA3AF",
  grey: "#9CA3AF",
  white: "#FFFFFF",
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function tryExtractFastPathWithAI(
  command: string,
  openaiApiKey: string
): Promise<{ match: FastPathMatch | null; confidence: number; reason: string }> {
  const openai = wrapOpenAI(new OpenAI({ apiKey: openaiApiKey }));

  const extractorPrompt = `Extract a deterministic whiteboard action from the user command.
Return JSON only.
If uncertain, return {"kind":"none","confidence":0,"reason":"..."}.

Allowed kinds:
- delete_all
- delete_by_type (objectType: sticky|rectangle|circle|frame|connector|shape)
- delete_shapes_except (keep: circle|rectangle)
- create_sticky_batch (count, optional topic, optional color)
- create_single_sticky (text, optional color, optional frameName)
- create_shape_batch (count, shape: rectangle|circle, optional color)
- query_summary`;

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: extractorPrompt },
          { role: "user", content: command },
        ],
        response_format: { type: "json_object" },
      }),
      5_000,
      "AI extractor timed out"
    );

    const raw = response.choices[0]?.message?.content;
    if (!raw) return { match: null, confidence: 0, reason: "empty_extractor_response" };

    const parsed = JSON.parse(raw);
    const kind = String(parsed.kind || "none");
    const confidence = Number(parsed.confidence || 0);
    const reason = String(parsed.reason || "ai_extractor");

    if (kind === "none") {
      return { match: null, confidence, reason };
    }

    let synthesized = "";
    if (kind === "delete_all") synthesized = "delete all";
    else if (kind === "delete_by_type") synthesized = `delete all ${parsed.objectType || "objects"}`;
    else if (kind === "delete_shapes_except") synthesized = `delete all shapes except ${parsed.keep || "circles"}`;
    else if (kind === "create_sticky_batch") synthesized = `create ${parsed.count || 0} sticky notes`;
    else if (kind === "create_single_sticky") synthesized = `add sticky note that says ${parsed.text || ""}`;
    else if (kind === "create_shape_batch") synthesized = `create ${parsed.count || 0} ${parsed.shape || "rectangle"}s`;
    else if (kind === "query_summary") synthesized = "what is on this board";

    const match = parseFastPath(synthesized);
    return { match, confidence, reason };
  } catch {
    return { match: null, confidence: 0, reason: "extractor_error" };
  }
}

async function tryExecuteFastPath(
  route: RouteResult,
  ctx: tools.ToolContext,
  boardObjects: CompactObject[],
  startTime: number,
  updateProgress: (status: string, step?: string) => Promise<void>,
  match: FastPathMatch | null
): Promise<AIExecutionResult | null> {
  if (!match) return null;

  await updateProgress("executing", "Fast path...");

  try {
    switch (match.kind) {
      case "delete_all": {
        const r = await tools.bulkDelete(ctx, "all");
        if (!r.success) return null;
        const deleted = r.data?.deletedCount ? [`all (${r.data.deletedCount})`] : ["all"];
        return {
          success: true,
          message: buildSummary([], [], deleted),
          objectsCreated: [],
          objectsUpdated: [],
          objectsDeleted: deleted,
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 1,
          durationMs: Date.now() - startTime,
        };
      }

      case "delete_by_type": {
        const r = await tools.bulkDelete(ctx, "by_type", undefined, match.objectType);
        if (!r.success) return null;
        const deletedIds = (r.data?.deletedIds as string[] | undefined) ?? [];
        const deleted = deletedIds.length > 0 ? deletedIds : [match.objectType];
        return {
          success: true,
          message: buildSummary([], [], deleted),
          objectsCreated: [],
          objectsUpdated: [],
          objectsDeleted: deleted,
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 1,
          durationMs: Date.now() - startTime,
        };
      }

      case "delete_shapes_except": {
        const keepType = match.keep;
        const idsToDelete = boardObjects
          .filter((o) => ["rectangle", "circle", "line"].includes(o.type))
          .filter((o) => o.type !== keepType)
          .map((o) => o.id);

        if (idsToDelete.length === 0) {
          return {
            success: true,
            message: "Nothing to delete.",
            objectsCreated: [],
            objectsUpdated: [],
            objectsDeleted: [],
            model: "fast-path",
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            toolCallsCount: 0,
            durationMs: Date.now() - startTime,
          };
        }

        const r = await tools.bulkDelete(ctx, "by_ids", idsToDelete);
        if (!r.success) return null;
        const deletedIds = (r.data?.deletedIds as string[] | undefined) ?? idsToDelete;
        return {
          success: true,
          message: buildSummary([], [], deletedIds),
          objectsCreated: [],
          objectsUpdated: [],
          objectsDeleted: deletedIds,
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 1,
          durationMs: Date.now() - startTime,
        };
      }

      case "create_sticky_batch": {
        const color = match.color ? COLOR_MAP[match.color] : "random";
        const items = Array.from({ length: match.count }).map((_, i) => {
          const text = match.topic
            ? `${titleCase(match.topic)} ${i + 1}`
            : `Sticky ${i + 1}`;
          return { type: "sticky" as const, text, color };
        });

        const r = await tools.bulkCreate(ctx, items);
        if (!r.success) return null;
        const createdIds = (r.data?.createdIds as string[] | undefined) ?? [];
        return {
          success: true,
          message: buildSummary(createdIds, [], []),
          objectsCreated: createdIds,
          objectsUpdated: [],
          objectsDeleted: [],
          focus: computeFocusBounds(createdIds, ctx.existingObjects),
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 1,
          durationMs: Date.now() - startTime,
        };
      }

      case "create_single_sticky": {
        let parentFrameId: string | undefined;
        if (match.frameName) {
          const needle = normalizeText(match.frameName);
          const frame = boardObjects.find(
            (o) =>
              o.type === "frame" &&
              o.text &&
              normalizeText(o.text).includes(needle)
          );
          if (!frame) return null; // fall back if frame not found
          parentFrameId = frame.id;
        }

        const color = match.color ? COLOR_MAP[match.color] ?? "#FBBF24" : "#FBBF24";
        const r = await tools.createStickyNote(
          ctx,
          match.text,
          undefined,
          undefined,
          color,
          parentFrameId
        );
        if (!r.success || !r.objectId) return null;
        return {
          success: true,
          message: buildSummary([r.objectId], [], []),
          objectsCreated: [r.objectId],
          objectsUpdated: [],
          objectsDeleted: [],
          focus: computeFocusBounds([r.objectId], ctx.existingObjects),
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 1,
          durationMs: Date.now() - startTime,
        };
      }

      case "create_shape_batch": {
        const color = match.color ? COLOR_MAP[match.color] : "random";
        const items = Array.from({ length: match.count }).map(() => ({
          type: match.shape,
          color,
          width: match.shape === "circle" ? 120 : 160,
          height: match.shape === "circle" ? 120 : 100,
        }));

        const r = await tools.bulkCreate(ctx, items);
        if (!r.success) return null;
        const createdIds = (r.data?.createdIds as string[] | undefined) ?? [];
        return {
          success: true,
          message: buildSummary(createdIds, [], []),
          objectsCreated: createdIds,
          objectsUpdated: [],
          objectsDeleted: [],
          focus: computeFocusBounds(createdIds, ctx.existingObjects),
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 1,
          durationMs: Date.now() - startTime,
        };
      }

      case "query_summary": {
        const counts = new Map<string, number>();
        for (const obj of boardObjects) {
          counts.set(obj.type, (counts.get(obj.type) ?? 0) + 1);
        }

        const total = boardObjects.length;
        const frames = boardObjects.filter((o) => o.type === "frame");
        const frameLines = frames
          .slice(0, 4)
          .map((f) => {
            const children = boardObjects.filter((o) => o.parentFrameId === f.id).length;
            return `${f.text || "Untitled"}: ${children} item(s)`;
          });

        const parts: string[] = [];
        if ((counts.get("sticky") ?? 0) > 0) parts.push(`${counts.get("sticky")} stickies`);
        if ((counts.get("frame") ?? 0) > 0) parts.push(`${counts.get("frame")} frames`);
        if ((counts.get("rectangle") ?? 0) > 0) parts.push(`${counts.get("rectangle")} rectangles`);
        if ((counts.get("circle") ?? 0) > 0) parts.push(`${counts.get("circle")} circles`);
        if ((counts.get("line") ?? 0) > 0) parts.push(`${counts.get("line")} lines`);

        const summary = parts.length > 0 ? parts.join(", ") : "no objects";
        const message = frameLines.length > 0
          ? `Board has ${total} objects: ${summary}. Frames — ${frameLines.join("; ")}.`
          : `Board has ${total} objects: ${summary}.`;

        return {
          success: true,
          message,
          objectsCreated: [],
          objectsUpdated: [],
          objectsDeleted: [],
          model: "fast-path",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          toolCallsCount: 0,
          durationMs: Date.now() - startTime,
        };
      }
    }
  } catch {
    // Any fast-path failure should gracefully fall back to LLM path.
    return null;
  }

  return null;
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
