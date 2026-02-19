/**
 * AI Agent Loop — GPT-4o with tool calling + streaming
 *
 * Runs a multi-turn conversation where the LLM can call tools
 * (create/update/delete objects) and read intermediate board state.
 * Streams text tokens back to the client in real time.
 */
import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import { TOOL_DEFINITIONS, executeTool } from "./aiTools.js";

const MAX_ITERATIONS = 8;

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

export const SYSTEM_PROMPT = `You are an AI assistant for CollabBoard, a collaborative whiteboard application. You help users create, modify, and organize objects on their board.

## Your capabilities:
- Create objects: sticky notes, rectangles, circles, text labels, and frames
- Create connectors (arrows/lines) between objects
- Update existing objects (move, resize, recolor, rename)
- Delete objects and connectors
- Read the current board state to understand what's on the canvas

## Layout guidelines:
- The canvas is large (effectively infinite). Place objects with enough spacing.
- For grid layouts, use ~20px gaps between objects.
- Sticky notes default to 150×150px. Rectangles default to 200×150px.
- Frames are containers — place objects inside them by setting parentFrameId.
- Frame titles appear at the top. Make frames taller/wider than their contents with ~40px padding on each side and ~60px top padding for the title.
- Use x/y coordinates to create structured layouts (rows, columns, grids).
- Place items starting around x:100, y:100 for a clean board. Check existing objects to avoid overlap.

## Color conventions:
- Sticky colors: yellow (#FBBF24), pink (#F472B6), blue (#3B82F6), green (#22C55E), orange (#F97316), purple (#A855F7)
- Shape colors: red (#EF4444), blue (#3B82F6), green (#22C55E), gray (#9CA3AF), black (#1F2937)
- Frame default: #E5E7EB (light gray)

## Common patterns:
- **SWOT analysis**: 4 colored frames in a 2×2 grid, each with a title (Strengths, Weaknesses, Opportunities, Threats) and a few stickies inside
- **Kanban/Sprint board**: 3-4 frames side by side (To Do, In Progress, Done, etc.)
- **Retrospective**: 3 frames (Went Well, Improve, Action Items) with colored stickies
- **Mind map**: Central topic shape with connectors radiating to sub-topic shapes
- **Flowchart**: Shapes connected with arrows in a top-to-bottom or left-to-right flow

## Rules:
1. Always use tool calls to modify the board — never just describe changes without executing them.
2. After creating objects that need to be connected, use the returned IDs in create_connectors.
3. For complex layouts, create objects first, then add connectors.
4. Read the board state first if you need to understand existing content or find object IDs.
5. Keep responses concise — the user sees objects appear in real time on the board.
6. If the user's request is ambiguous, make reasonable assumptions and proceed.`;

export interface AgentStreamEvent {
  type: "text" | "tool_start" | "tool_result" | "done" | "error" | "meta" | "navigate";
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
  // wrapOpenAI automatically traces every LLM call to LangSmith as a child
  // span when LANGSMITH_TRACING=true. It's a no-op when tracing is off.
  const openai = wrapOpenAI(new OpenAI({ apiKey: openaiApiKey }));

  const complexity = classifyComplexity(userCommand);
  const model = complexity === "complex" ? MODEL_COMPLEX : MODEL_SIMPLE;

  // Let the client know which model was selected
  yield { type: "meta", content: JSON.stringify({ model, complexity }) };

  // Build viewport context block if we have the data
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

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content:
        `## Current Board State\n\`\`\`json\n${JSON.stringify(boardState, null, 2)}\n\`\`\`` +
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
        tools: TOOL_DEFINITIONS,
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
      for (const tc of toolCallEntries) {
        yield { type: "tool_start", content: tc.name };
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
            });
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
      for (const tr of toolResults) {
        const res = tr.result as any;
        if (res?._viewport) {
          yield { type: "navigate", content: JSON.stringify(res._viewport) };
        }
        yield {
          type: "tool_result",
          content: JSON.stringify({ tool: tr.name, result: tr.result }),
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
