// Supabase Edge Function: AI Agent for CollabBoard
// Deno runtime — imports use npm: and https: specifiers

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import OpenAI from "https://esm.sh/openai@4.78.1";
import { Langfuse } from "https://esm.sh/langfuse@3.32.0";

// ─── Types ────────────────────────────────────────────────────

interface Viewport {
  minX: number; minY: number; maxX: number; maxY: number;
  centerX: number; centerY: number; scale: number;
}

interface AICommandPayload {
  commandId: string;
  boardId: string;
  command: string;
  viewport: Viewport;
  selectedObjectIds: string[];
  pointer?: { x: number; y: number };
}

interface BoardObject {
  id: string; type: string;
  x: number; y: number; width: number; height: number;
  color: string; text: string; rotation: number;
  z_index: number; parent_frame_id: string | null;
  created_by: string;
}

interface Connector {
  id: string; from_id: string; to_id: string; style: string;
}

// ─── Constants ────────────────────────────────────────────────

const MAX_TOOL_CALLS = 25;
const MAX_OBJECTS_CREATED = 25;
const MAX_ITERATIONS = 6;
const MAX_TEXT_LENGTH = 500;
const COORD_CLAMP = 50000;
const MIN_SIZE = 50;
const MAX_SIZE = 2000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const COLORS: Record<string, string> = {
  yellow: "#FBBF24", pink: "#F472B6", blue: "#60A5FA", green: "#34D399",
  orange: "#FB923C", purple: "#C084FC", red: "#F87171", gray: "#9CA3AF",
  white: "#F8FAFC",
};

// ─── Rate Limiting (per isolate) ──────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function resolveColor(input: string | undefined): string {
  if (!input) return COLORS.yellow;
  const lower = input.toLowerCase().trim();
  if (COLORS[lower]) return COLORS[lower];
  if (/^#[0-9a-f]{6}$/i.test(input)) return input;
  return COLORS.yellow;
}

function resolvePlacement(
  desiredX: number, desiredY: number,
  w: number, h: number,
  viewport: Viewport,
  existing: BoardObject[]
): { x: number; y: number } {
  const candidate = { x: clamp(desiredX, -COORD_CLAMP, COORD_CLAMP), y: clamp(desiredY, -COORD_CLAMP, COORD_CLAMP) };

  function overlaps(x: number, y: number): boolean {
    for (const obj of existing) {
      if (x < obj.x + obj.width && x + w > obj.x && y < obj.y + obj.height && y + h > obj.y) {
        return true;
      }
    }
    return false;
  }

  if (!overlaps(candidate.x, candidate.y)) return candidate;

  // Spiral outward
  for (let radius = 40; radius <= 1200; radius += 40) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const tx = candidate.x + Math.cos(rad) * radius;
      const ty = candidate.y + Math.sin(rad) * radius;
      if (!overlaps(tx, ty)) return { x: Math.round(tx), y: Math.round(ty) };
    }
  }

  return { x: candidate.x + 200, y: candidate.y + 200 };
}

// ─── Tool Schemas ─────────────────────────────────────────────

const toolSchemas: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_sticky_note",
      description: "Create a sticky note on the board. Use parentFrameId to place it inside an existing frame.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content" },
          x: { type: "number", description: "X position in canvas coords" },
          y: { type: "number", description: "Y position in canvas coords" },
          color: { type: "string", description: "Color name or hex (yellow, pink, blue, green, orange, purple, red, gray, white)" },
          parentFrameId: { type: "string", description: "ID of a frame to place this sticky inside of" },
        },
        required: ["text", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_shape",
      description: "Create a rectangle or circle shape. Use parentFrameId to place it inside a frame.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["rectangle", "circle"], description: "Shape type" },
          x: { type: "number" }, y: { type: "number" },
          width: { type: "number" }, height: { type: "number" },
          color: { type: "string" },
          parentFrameId: { type: "string", description: "ID of a frame to place this shape inside of" },
        },
        required: ["type", "x", "y", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_frame",
      description: "Create a named frame (container) on the board",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Frame title" },
          x: { type: "number" }, y: { type: "number" },
          width: { type: "number" }, height: { type: "number" },
        },
        required: ["title", "x", "y", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_connector",
      description: "Create an arrow or line connecting two objects",
      parameters: {
        type: "object",
        properties: {
          fromId: { type: "string", description: "Source object ID" },
          toId: { type: "string", description: "Target object ID" },
          style: { type: "string", enum: ["arrow", "line"], description: "Connector style" },
        },
        required: ["fromId", "toId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_object",
      description: "Move an existing object to a new position",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string" },
          x: { type: "number" }, y: { type: "number" },
        },
        required: ["objectId", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resize_object",
      description: "Resize an existing object",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string" },
          width: { type: "number" }, height: { type: "number" },
        },
        required: ["objectId", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_text",
      description: "Update the text content of an object",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string" },
          newText: { type: "string" },
        },
        required: ["objectId", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_color",
      description: "Change the color of an object",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string" },
          color: { type: "string" },
        },
        required: ["objectId", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_state",
      description: "Get current board objects and connectors for context. Call this when you need to reference existing objects.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    supabase: ReturnType<typeof createClient>;
    boardId: string;
    uid: string;
    viewport: Viewport;
    objects: BoardObject[];
    connectors: Connector[];
    createdIds: string[];
    updatedIds: string[];
    langfuseTrace: any;
  }
): Promise<string> {
  const { supabase, boardId, uid, viewport, objects } = ctx;

  const span = ctx.langfuseTrace?.span({ name: `tool:${name}`, input: args });

  try {
    let result: string;

    switch (name) {
      case "create_sticky_note": {
        if (ctx.createdIds.length >= MAX_OBJECTS_CREATED) return "Error: max objects created limit reached";
        const text = String(args.text || "").slice(0, MAX_TEXT_LENGTH);
        const color = resolveColor(args.color as string);
        const parentFrameId = args.parentFrameId ? String(args.parentFrameId) : null;
        const pos = resolvePlacement(
          Number(args.x) || viewport.centerX, Number(args.y) || viewport.centerY,
          150, 150, viewport, objects
        );
        const row: Record<string, unknown> = {
          board_id: boardId, type: "sticky",
          x: pos.x, y: pos.y, width: 150, height: 150,
          color, text, created_by: uid, z_index: Date.now(),
        };
        if (parentFrameId) row.parent_frame_id = parentFrameId;
        const { data, error } = await supabase.from("objects").insert(row).select("id").single();
        if (error) return `Error: ${error.message}`;
        ctx.createdIds.push(data.id);
        objects.push({ ...data, type: "sticky", x: pos.x, y: pos.y, width: 150, height: 150, color, text, rotation: 0, z_index: 0, parent_frame_id: parentFrameId, created_by: uid });
        result = JSON.stringify({ id: data.id, x: pos.x, y: pos.y, parentFrameId });
        break;
      }

      case "create_shape": {
        if (ctx.createdIds.length >= MAX_OBJECTS_CREATED) return "Error: max objects created limit reached";
        const shapeType = args.type === "circle" ? "circle" : "rectangle";
        const w = clamp(Number(args.width) || 150, MIN_SIZE, MAX_SIZE);
        const h = clamp(Number(args.height) || 100, MIN_SIZE, MAX_SIZE);
        const color = resolveColor(args.color as string);
        const parentFrameId = args.parentFrameId ? String(args.parentFrameId) : null;
        const pos = resolvePlacement(
          Number(args.x) || viewport.centerX, Number(args.y) || viewport.centerY,
          w, h, viewport, objects
        );
        const row: Record<string, unknown> = {
          board_id: boardId, type: shapeType,
          x: pos.x, y: pos.y, width: w, height: h,
          color, text: "", created_by: uid, z_index: Date.now(),
        };
        if (parentFrameId) row.parent_frame_id = parentFrameId;
        const { data, error } = await supabase.from("objects").insert(row).select("id").single();
        if (error) return `Error: ${error.message}`;
        ctx.createdIds.push(data.id);
        objects.push({ ...data, type: shapeType, x: pos.x, y: pos.y, width: w, height: h, color, text: "", rotation: 0, z_index: 0, parent_frame_id: parentFrameId, created_by: uid });
        result = JSON.stringify({ id: data.id, x: pos.x, y: pos.y, width: w, height: h });
        break;
      }

      case "create_frame": {
        if (ctx.createdIds.length >= MAX_OBJECTS_CREATED) return "Error: max objects created limit reached";
        const title = String(args.title || "Frame").slice(0, MAX_TEXT_LENGTH);
        const w = clamp(Number(args.width) || 400, MIN_SIZE, MAX_SIZE);
        const h = clamp(Number(args.height) || 300, MIN_SIZE, MAX_SIZE);
        const pos = resolvePlacement(
          Number(args.x) || viewport.centerX, Number(args.y) || viewport.centerY,
          w, h, viewport, objects
        );
        const { data, error } = await supabase.from("objects").insert({
          board_id: boardId, type: "frame",
          x: pos.x, y: pos.y, width: w, height: h,
          color: "#F8FAFC", text: title, created_by: uid, z_index: Date.now(),
        }).select("id").single();
        if (error) return `Error: ${error.message}`;
        ctx.createdIds.push(data.id);
        objects.push({ ...data, type: "frame", x: pos.x, y: pos.y, width: w, height: h, color: "#F8FAFC", text: title, rotation: 0, z_index: 0, parent_frame_id: null, created_by: uid });
        result = JSON.stringify({ id: data.id, x: pos.x, y: pos.y, width: w, height: h });
        break;
      }

      case "create_connector": {
        const fromId = String(args.fromId);
        const toId = String(args.toId);
        const style = args.style === "line" ? "line" : "arrow";
        const { data, error } = await supabase.from("connectors").insert({
          board_id: boardId, from_id: fromId, to_id: toId, style,
        }).select("id").single();
        if (error) return `Error: ${error.message}`;
        ctx.createdIds.push(data.id);
        result = JSON.stringify({ id: data.id });
        break;
      }

      case "move_object": {
        const objectId = String(args.objectId);
        const x = clamp(Number(args.x), -COORD_CLAMP, COORD_CLAMP);
        const y = clamp(Number(args.y), -COORD_CLAMP, COORD_CLAMP);
        const obj = objects.find(o => o.id === objectId);
        if (!obj) return `Error: object ${objectId} not found`;

        const dx = x - obj.x;
        const dy = y - obj.y;

        // Move the object itself
        const { error } = await supabase.from("objects")
          .update({ x, y }).eq("id", objectId).eq("board_id", boardId);
        if (error) return `Error: ${error.message}`;
        ctx.updatedIds.push(objectId);
        obj.x = x;
        obj.y = y;

        // If it's a frame, move all contained children by the same delta
        if (obj.type === "frame") {
          const children = objects.filter(o => o.parent_frame_id === objectId);
          for (const child of children) {
            const cx = clamp(child.x + dx, -COORD_CLAMP, COORD_CLAMP);
            const cy = clamp(child.y + dy, -COORD_CLAMP, COORD_CLAMP);
            await supabase.from("objects")
              .update({ x: cx, y: cy }).eq("id", child.id).eq("board_id", boardId);
            ctx.updatedIds.push(child.id);
            child.x = cx;
            child.y = cy;
          }
        }

        result = JSON.stringify({ objectId, x, y, childrenMoved: obj.type === "frame" ? objects.filter(o => o.parent_frame_id === objectId).length : 0 });
        break;
      }

      case "resize_object": {
        const objectId = String(args.objectId);
        const w = clamp(Number(args.width), MIN_SIZE, MAX_SIZE);
        const h = clamp(Number(args.height), MIN_SIZE, MAX_SIZE);
        const { error } = await supabase.from("objects")
          .update({ width: w, height: h }).eq("id", objectId).eq("board_id", boardId);
        if (error) return `Error: ${error.message}`;
        ctx.updatedIds.push(objectId);
        result = JSON.stringify({ objectId, width: w, height: h });
        break;
      }

      case "update_text": {
        const objectId = String(args.objectId);
        const text = String(args.newText || "").slice(0, MAX_TEXT_LENGTH);
        const { error } = await supabase.from("objects")
          .update({ text }).eq("id", objectId).eq("board_id", boardId);
        if (error) return `Error: ${error.message}`;
        ctx.updatedIds.push(objectId);
        result = JSON.stringify({ objectId, text });
        break;
      }

      case "change_color": {
        const objectId = String(args.objectId);
        const color = resolveColor(args.color as string);
        const { error } = await supabase.from("objects")
          .update({ color }).eq("id", objectId).eq("board_id", boardId);
        if (error) return `Error: ${error.message}`;
        ctx.updatedIds.push(objectId);
        result = JSON.stringify({ objectId, color });
        break;
      }

      case "get_board_state": {
        const compact = objects.map(o => ({
          id: o.id, type: o.type, x: o.x, y: o.y,
          width: o.width, height: o.height, color: o.color,
          text: o.text || "", parentFrameId: o.parent_frame_id,
        }));
        result = JSON.stringify({ objects: compact, connectors: ctx.connectors });
        break;
      }

      default:
        result = `Error: unknown tool ${name}`;
    }

    span?.end({ output: result });
    return result;
  } catch (e) {
    const err = `Error: ${e instanceof Error ? e.message : String(e)}`;
    span?.end({ output: err, level: "ERROR" });
    return err;
  }
}

// ─── Build System Prompt ──────────────────────────────────────

function buildSystemPrompt(viewport: Viewport, objects: BoardObject[], selectedIds: string[]): string {
  const selectedContext = selectedIds.length > 0
    ? `Selected objects: ${selectedIds.join(", ")}`
    : "No objects selected.";

  const boardSummary = objects.length > 0
    ? `Board has ${objects.length} objects:\n` +
      objects.slice(0, 50).map(o =>
        `  - ${o.id} (${o.type}) at (${o.x},${o.y}) ${o.width}x${o.height} "${o.text || ""}" color:${o.color}`
      ).join("\n")
    : "Board is empty.";

  return `You are an AI assistant for a collaborative whiteboard called CollabBoard.
You manipulate the board using the provided tools. Always use tools — never respond with text only.

The user's visible viewport in canvas coordinates:
  Top-left: (${Math.round(viewport.minX)}, ${Math.round(viewport.minY)})
  Bottom-right: (${Math.round(viewport.maxX)}, ${Math.round(viewport.maxY)})
  Center: (${Math.round(viewport.centerX)}, ${Math.round(viewport.centerY)})
  Zoom: ${viewport.scale.toFixed(2)}x

${boardSummary}

${selectedContext}

Guidelines:
- Place new objects within the user's viewport, near the center
- Use consistent spacing: 200px between stickies, 280px between frames
- Avoid overlapping existing objects
- For templates (SWOT, retro, kanban, journey map), create a well-organized layout
- Use create_frame for grouping related items
- Connect related items with create_connector when appropriate

Available colors: yellow (#FBBF24), pink (#F472B6), blue (#60A5FA), green (#34D399),
orange (#FB923C), purple (#C084FC), red (#F87171), gray (#9CA3AF), white (#F8FAFC).`;
}

// ─── Main Handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
      },
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  // Init LangFuse
  const langfuse = new Langfuse({
    secretKey: Deno.env.get("LANGFUSE_SECRET_KEY") || "",
    publicKey: Deno.env.get("LANGFUSE_PUBLIC_KEY") || "",
    baseUrl: Deno.env.get("LANGFUSE_BASEURL") || "https://cloud.langfuse.com",
  });

  let trace: any = null;

  try {
    // 1. Auth — verify Supabase JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), { status: 401, headers: corsHeaders });
    }
    const token = authHeader.slice(7);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create a client with the user's JWT to verify identity
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), { status: 401, headers: corsHeaders });
    }
    const uid = user.id;

    // Service-role client for DB operations (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse + validate payload
    const body: AICommandPayload = await req.json();
    if (!body.commandId || !body.boardId || !body.command) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }
    if (body.command.length > 1000) {
      return new Response(JSON.stringify({ error: "Command too long" }), { status: 400, headers: corsHeaders });
    }

    // 3. Authorize: user is a member of this board
    const { data: membership } = await supabase
      .from("board_members")
      .select("board_id")
      .eq("board_id", body.boardId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Not authorized for this board" }), { status: 403, headers: corsHeaders });
    }

    // 4. Rate limit
    if (!checkRateLimit(uid)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded (10/min)" }), { status: 429, headers: corsHeaders });
    }

    // 5. Idempotency
    const { data: existingRun } = await supabase
      .from("ai_runs")
      .select("status, response")
      .eq("board_id", body.boardId)
      .eq("command_id", body.commandId)
      .maybeSingle();

    if (existingRun?.status === "completed" && existingRun.response) {
      return new Response(JSON.stringify(existingRun.response), { headers: corsHeaders });
    }

    // Mark as started
    await supabase.from("ai_runs").upsert({
      command_id: body.commandId,
      board_id: body.boardId,
      user_id: uid,
      command: body.command.slice(0, 1000),
      status: "started",
    });

    // 6. Start LangFuse trace
    trace = langfuse.trace({
      name: "ai-agent-command",
      userId: uid,
      metadata: { boardId: body.boardId, command: body.command },
      input: { command: body.command, viewport: body.viewport, selectedObjectIds: body.selectedObjectIds },
    });

    // 7. Load board state (viewport + margin)
    const margin = 400;
    const { data: objectRows } = await supabase
      .from("objects")
      .select("*")
      .eq("board_id", body.boardId);
    const objects: BoardObject[] = (objectRows || []) as BoardObject[];

    const { data: connectorRows } = await supabase
      .from("connectors")
      .select("*")
      .eq("board_id", body.boardId);
    const connectors: Connector[] = (connectorRows || []) as Connector[];

    // 8. OpenAI tool loop
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
    const startTime = Date.now();
    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    let totalToolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(body.viewport, objects, body.selectedObjectIds) },
      { role: "user", content: body.command },
    ];

    const model = "gpt-4o";
    let finalMessage = "";

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const generation = trace.generation({
        name: `openai-call-${iter}`,
        model,
        input: messages,
      });

      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: toolSchemas,
        tool_choice: iter === 0 ? "required" : "auto",
        temperature: 0.3,
      });

      const choice = completion.choices[0];
      const msg = choice.message;
      inputTokens += completion.usage?.prompt_tokens || 0;
      outputTokens += completion.usage?.completion_tokens || 0;

      generation.end({
        output: msg,
        usage: {
          input: completion.usage?.prompt_tokens,
          output: completion.usage?.completion_tokens,
          total: completion.usage?.total_tokens,
        },
      });

      messages.push(msg);

      // If no tool calls, we're done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalMessage = msg.content || "Done";
        break;
      }

      // Execute tool calls
      for (const toolCall of msg.tool_calls) {
        if (totalToolCalls >= MAX_TOOL_CALLS) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Error: tool call limit reached",
          });
          continue;
        }
        totalToolCalls++;

        const args = JSON.parse(toolCall.function.arguments);
        const toolResult = await executeTool(toolCall.function.name, args, {
          supabase, boardId: body.boardId, uid,
          viewport: body.viewport, objects, connectors,
          createdIds, updatedIds, langfuseTrace: trace,
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }

      // If model said stop, we're done
      if (choice.finish_reason === "stop") {
        finalMessage = msg.content || "Done";
        break;
      }
    }

    if (!finalMessage) {
      finalMessage = `Created ${createdIds.length} objects, updated ${updatedIds.length} objects.`;
    }

    const durationMs = Date.now() - startTime;

    // 9. Compute focus bounds
    let focus: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
    if (createdIds.length > 0) {
      const created = objects.filter(o => createdIds.includes(o.id));
      if (created.length > 0) {
        focus = {
          minX: Math.min(...created.map(o => o.x)),
          minY: Math.min(...created.map(o => o.y)),
          maxX: Math.max(...created.map(o => o.x + o.width)),
          maxY: Math.max(...created.map(o => o.y + o.height)),
        };
      }
    }

    // 10. Build response
    const response = {
      success: true,
      message: finalMessage,
      objectsCreated: createdIds,
      objectsUpdated: [...new Set(updatedIds)],
      objectsDeleted: [],
      focus,
      runId: body.commandId,
    };

    // 11. Update ai_runs
    await supabase.from("ai_runs").update({
      status: "completed",
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      tool_calls_count: totalToolCalls,
      objects_created: createdIds,
      objects_updated: [...new Set(updatedIds)],
      duration_ms: durationMs,
      response,
    }).eq("board_id", body.boardId).eq("command_id", body.commandId);

    // 12. Finalize LangFuse trace (fire-and-forget — don't block the response)
    trace.update({ output: response, metadata: { durationMs, toolCalls: totalToolCalls, model } });
    langfuse.shutdownAsync().catch(() => {});

    return new Response(JSON.stringify(response), { headers: corsHeaders });

  } catch (error) {
    console.error("AI agent error:", error);
    if (trace) {
      trace.update({ output: { error: String(error) }, level: "ERROR" });
      langfuse.shutdownAsync().catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
