/**
 * POST /api/ai-vercel — AI Agent endpoint (Vercel AI SDK / Edge runtime)
 *
 * Drop-in replacement for /api/ai that runs on Vercel's Edge Runtime:
 *   - ~0 ms cold start (V8 isolate, vs 300–800 ms for Node.js serverless)
 *   - Progressive token streaming from the first step
 *   - Built-in agentic loop via maxSteps (no manual while loop)
 *
 * Emits the identical SSE event format as /api/ai so the client
 * needs zero changes to switch endpoints.
 *
 * OpenAI key: same OPENAI_API_KEY env var — @ai-sdk/openai is just a
 * thin fetch wrapper around the same REST API.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, jsonSchema } from "ai";
import { verifyToken, assertCanWriteBoard, AuthError } from "./_lib/auth.js";
import {
  TOOL_DEFINITIONS,
  executeTool,
  fetchBoardState,
} from "./_lib/aiTools.js";
import {
  classifyComplexity,
  computeViewBounds,
  SYSTEM_PROMPT,
  MODEL_SIMPLE,
  MODEL_COMPLEX,
} from "./_lib/aiAgent.js";

// Tell Vercel to run this on the Edge Runtime (V8 isolate, global PoP)
export const config = { runtime: "edge" };

// ─── Tool factory ─────────────────────────────────────────────
// Wraps each existing JSON-schema tool definition with an execute function.
// The execute function runs server-side automatically when the LLM triggers
// a tool call — no manual dispatch loop needed.
function makeTools(
  boardId: string,
  userId: string,
  screenSize?: { width: number; height: number },
  selectedIds?: string[]
) {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  for (const def of TOOL_DEFINITIONS) {
    const { name, description, parameters } = def.function;

    tools[name] = tool({
      description: description ?? "",
      // jsonSchema() lets us reuse the existing OpenAI JSON schemas verbatim
      // rather than rewriting every tool in Zod.
      parameters: jsonSchema(parameters as Record<string, unknown>),
      execute: async (args) =>
        executeTool(name, args as Record<string, unknown>, boardId, userId, {
          screenSize,
          selectedIds,
        }),
    });
  }

  return tools;
}

// ─── Handler ──────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Auth ───────────────────────────────────────────────
  let userId: string;
  try {
    userId = await verifyToken(req.headers.get("authorization"));
  } catch (err) {
    if (err instanceof AuthError)
      return json({ error: err.message }, err.status);
    return json({ error: "Auth check failed" }, 500);
  }

  // ── Body ───────────────────────────────────────────────
  let body: {
    boardId?: string;
    command?: string;
    viewport?: { x: number; y: number; scale: number };
    screenSize?: { width: number; height: number };
    conversationHistory?: Array<{ user: string; assistant: string }>;
    selectedIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    boardId,
    command,
    conversationHistory,
    viewport,
    screenSize,
    selectedIds,
  } = body;

  if (!boardId || typeof boardId !== "string")
    return json({ error: "Missing boardId" }, 400);
  if (!command || typeof command !== "string" || command.trim().length === 0)
    return json({ error: "Missing command" }, 400);
  if (command.length > 2000)
    return json({ error: "Command too long (max 2000 chars)" }, 400);

  // ── Board access ───────────────────────────────────────
  try {
    await assertCanWriteBoard(userId, boardId);
  } catch (err) {
    if (err instanceof AuthError)
      return json({ error: err.message }, err.status);
    return json({ error: "Board access check failed" }, 500);
  }

  // ── OpenAI key ─────────────────────────────────────────
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey)
    return json({ error: "OPENAI_API_KEY not configured" }, 500);

  // ── Model selection ────────────────────────────────────
  const cmd = command.trim();
  const complexity = classifyComplexity(cmd);
  const modelId = complexity === "complex" ? MODEL_COMPLEX : MODEL_SIMPLE;
  const openai = createOpenAI({ apiKey: openaiApiKey });

  // ── Context ────────────────────────────────────────────
  const boardState = await fetchBoardState(boardId);

  let viewportContext = "";
  if (viewport && screenSize) {
    const vb = computeViewBounds(viewport, screenSize);
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

  const selectionContext =
    Array.isArray(selectedIds) && selectedIds.length > 0
      ? `\n\n## Currently Selected Objects\nThe user has these object IDs selected: ${selectedIds.join(", ")}.\nWhen the user says "the selected", "these", "them", "those" — they mean these objects.\nTools that accept ids (arrange_objects, duplicate_objects, navigate_to_objects) will default to these if you omit ids.`
      : "";

  const systemContext =
    `## Current Board State\n\`\`\`json\n${JSON.stringify(boardState, null, 2)}\n\`\`\`` +
    viewportContext +
    selectionContext;

  // Prior conversation turns (give the agent memory)
  const priorMessages: Array<{ role: "user" | "assistant"; content: string }> =
    [];
  for (const turn of conversationHistory ?? []) {
    priorMessages.push({ role: "user", content: turn.user });
    priorMessages.push({ role: "assistant", content: turn.assistant });
  }

  // ── SSE stream ─────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: { type: string; content: string }) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );

      try {
        // Announce the chosen model to the client
        write({ type: "meta", content: JSON.stringify({ model: modelId, complexity }) });

        const result = streamText({
          model: openai(modelId),
          // system + board state injected as the system prompt
          system: SYSTEM_PROMPT + "\n\n" + systemContext,
          messages: [
            ...priorMessages,
            { role: "user", content: cmd },
          ],
          tools: makeTools(boardId, userId, screenSize, selectedIds),
          maxSteps: 8,          // agentic loop handled by the SDK
          temperature: 0.3,
          maxTokens: 4096,
        });

        // ── Stream conversion ────────────────────────────
        // We only emit text to the client from non-tool-call steps.
        // This prevents "doubled text" — where the model narrates before
        // calling a tool and then narrates again in the final step.
        let stepText = "";
        let stepHasToolCalls = false;

        for await (const part of result.fullStream) {
          switch (part.type) {
            // Accumulate text deltas — don't emit yet
            case "text-delta":
              stepText += part.text;
              break;

            // Tool input starts streaming — show the user immediately
            // (fires earlier than 'tool-call', which waits for full args)
            case "tool-input-start":
              stepHasToolCalls = true;
              write({ type: "tool_start", content: part.toolName });
              break;

            // Tool has executed (execute() ran automatically)
            case "tool-result": {
              const res = part.result as Record<string, unknown> | null;
              if (res?._viewport) {
                write({ type: "navigate", content: JSON.stringify(res._viewport) });
              }
              write({
                type: "tool_result",
                content: JSON.stringify({ tool: part.toolName, result: part.result }),
              });
              break;
            }

            // Step boundary — emit text only from the final (non-tool) step
            case "finish-step":
              if (!stepHasToolCalls && stepText) {
                write({ type: "text", content: stepText });
              }
              stepText = "";
              stepHasToolCalls = false;
              break;

            case "error":
              write({ type: "error", content: String(part.error) });
              break;
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        write({ type: "error", content: msg });
      }

      write({ type: "done", content: "" });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
