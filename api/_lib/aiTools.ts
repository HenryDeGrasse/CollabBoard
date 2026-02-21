/**
 * AI Agent Tool Definitions + Execution Layer
 *
 * Maps GPT-4o tool calls directly to supabaseAdmin DB operations.
 * No HTTP roundtrips — writes go straight to Postgres.
 */
import OpenAI from "openai";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

function generateUUID(): string {
  return crypto.randomUUID();
}

// ─── Tool Definitions (OpenAI function-calling schema) ─────────

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "createQuadrant",
      description: "Create a 2x2 quadrant layout (like SWOT or Eisenhower matrix). Returns the master frameId which can be used to add more items later.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title for the main bounding frame (e.g. 'SWOT Analysis')" },
          xAxisLabel: { type: "string", description: "Label for the X axis" },
          yAxisLabel: { type: "string", description: "Label for the Y axis" },
          quadrantLabels: {
            type: "object",
            properties: {
              topLeft: { type: "string", description: "Top-left quadrant title" },
              topRight: { type: "string", description: "Top-right quadrant title" },
              bottomLeft: { type: "string", description: "Bottom-left quadrant title" },
              bottomRight: { type: "string", description: "Bottom-right quadrant title" }
            },
            required: ["topLeft", "topRight", "bottomLeft", "bottomRight"]
          },
          items: {
            type: "object",
            properties: {
              topLeft: { type: "array", items: { type: "string" }, description: "Items for the top-left quadrant" },
              topRight: { type: "array", items: { type: "string" }, description: "Items for the top-right quadrant" },
              bottomLeft: { type: "array", items: { type: "string" }, description: "Items for the bottom-left quadrant" },
              bottomRight: { type: "array", items: { type: "string" }, description: "Items for the bottom-right quadrant" }
            }
          },
          startX: { type: "number", description: "Starting X position on the canvas" },
          startY: { type: "number", description: "Starting Y position on the canvas" }
        },
        required: ["title", "quadrantLabels"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "createColumnLayout",
      description: "Create a column-based layout (like Kanban or Retrospective). Returns the master frameId and a 'columnIds' map (title -> column frameId) which you can use as parentFrameId in bulk_create_objects to add more stickies to specific columns.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title for the main bounding frame (e.g. 'Sprint Retrospective')" },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Column header text" },
                items: { type: "array", items: { type: "string" }, description: "Sticky note items for this column" }
              },
              required: ["title"]
            },
            description: "Array of columns with their respective titles and items"
          },
          startX: { type: "number", description: "Starting X position on the canvas" },
          startY: { type: "number", description: "Starting Y position on the canvas" }
        },
        required: ["title", "columns"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_objects",
      description:
        "Create one or more objects on the board. Use this to add sticky notes, rectangles, circles, text labels, or frames. Returns the created object IDs. For layout tasks, place objects with specific x/y coordinates to form grids, rows, or structured arrangements. To add items inside an EXISTING frame, you MUST use bulk_create_objects instead, as it automatically computes the x/y positions.",
      parameters: {
        type: "object",
        properties: {
          objects: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["sticky", "rectangle", "circle", "text", "frame"],
                  description: "Object type",
                },
                x: { type: "number", description: "X position on the canvas" },
                y: { type: "number", description: "Y position on the canvas" },
                width: { type: "number", description: "Width in pixels (default: sticky=150, rectangle=200, circle=120, text=200, frame=400)" },
                height: { type: "number", description: "Height in pixels (default: sticky=150, rectangle=150, circle=120, text=50, frame=300)" },
                color: {
                  type: "string",
                  description:
                    "Hex color. Sticky colors: #FAD84E (yellow), #F5A8C4 (pink), #7FC8E8 (blue), #9DD9A3 (green), #E5E5E0 (grey), #F9F9F7 (offwhite). Shape colors: #111111 (black), #CC0000 (red), #3B82F6 (blue), #404040 (darkgrey), #E5E5E0 (grey). Frame default: #F9F9F7.",
                },
                text: { type: "string", description: "Text content to display on the object" },
                rotation: { type: "number", description: "Rotation in degrees (default: 0)" },
                parentFrameId: { type: "string", description: "ID of the parent frame if this object should be contained within one" },
              },
              required: ["type", "x", "y"],
            },
            description: "Array of objects to create",
          },
        },
        required: ["objects"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_create_objects",
      description:
        "Create a large number of objects (10+) efficiently in a single call. Use this instead of create_objects when the user wants many objects. " +
        "Supports unique AI-generated content via contentPrompt (e.g., 'a fun fact about animals'), or patterned text via textPattern (e.g., 'Task {i}'). " +
        "All objects share the same type, color, and size. Layout is computed automatically.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["sticky", "rectangle", "circle", "text", "frame"],
            description: "Object type for all created objects",
          },
          count: {
            type: "number",
            description: "Number of objects to create (max 500)",
          },
          color: {
            type: "string",
            description:
              "Hex color or color name for all objects. Sticky colors: #FAD84E (yellow), #F5A8C4 (pink), #7FC8E8 (blue), #9DD9A3 (green), #E5E5E0 (grey), #F9F9F7 (offwhite).",
          },
          layout: {
            type: "string",
            enum: ["grid", "vertical", "horizontal"],
            description: "How to arrange the objects (default: grid)",
          },
          columns: {
            type: "number",
            description: "Number of columns for grid layout (default: auto based on count)",
          },
          gap: {
            type: "number",
            description: "Spacing between objects in pixels (default: 20)",
          },
          startX: {
            type: "number",
            description: "Starting X position on the canvas (default: 100)",
          },
          startY: {
            type: "number",
            description: "Starting Y position on the canvas (default: 100)",
          },
          width: {
            type: "number",
            description: "Width of each object in pixels (uses type default if omitted)",
          },
          height: {
            type: "number",
            description: "Height of each object in pixels (uses type default if omitted)",
          },
          contentPrompt: {
            type: "string",
            description:
              "AI prompt to generate unique text for EACH object. Example: 'a unique fun fact about space'. " +
              "The server will use AI to generate the requested number of unique items.",
          },
          textPattern: {
            type: "string",
            description:
              "Pattern with {i} placeholder for sequential numbering. Example: 'Task {i}' produces 'Task 1', 'Task 2', etc. " +
              "Used when contentPrompt is not provided.",
          },
          parentFrameId: {
            type: "string",
            description: "ID of the parent frame if objects should be contained within one",
          },
        },
        required: ["type", "count"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_connectors",
      description:
        "Create one or more connectors (arrows or lines) between objects. Use fromId/toId to connect existing objects. Use fromPoint/toPoint for free-floating endpoints.",
      parameters: {
        type: "object",
        properties: {
          connectors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fromId: { type: "string", description: "ID of the source object (empty string for free point)" },
                toId: { type: "string", description: "ID of the target object (empty string for free point)" },
                style: { type: "string", enum: ["arrow", "line"], description: "Connector style (default: arrow)" },
                fromPoint: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  description: "Free-floating source anchor (used when fromId is empty)",
                },
                toPoint: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  description: "Free-floating target anchor (used when toId is empty)",
                },
                color: { type: "string", description: "Hex color for the connector (default: #4B5563)" },
                strokeWidth: { type: "number", description: "Stroke thickness in px (default: 2.5)" },
              },
              required: ["style"],
            },
            description: "Array of connectors to create",
          },
        },
        required: ["connectors"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_objects",
      description:
        "Update one or more existing objects. Pass an array of patches with the object ID and the fields to change. Only include fields you want to modify.",
      parameters: {
        type: "object",
        properties: {
          patches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID of the object to update" },
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
                color: { type: "string" },
                text: { type: "string" },
                rotation: { type: "number" },
                parentFrameId: { type: "string", description: "Set to frame ID to nest, or empty string to un-nest" },
              },
              required: ["id"],
            },
            description: "Array of update patches",
          },
        },
        required: ["patches"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_objects",
      description: "Delete one or more objects from the board by their IDs. Also cleans up any connectors attached to deleted objects.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of object IDs to delete",
          },
        },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_objects_by_filter",
      description:
        "Delete objects matching a color and/or type filter without needing to know their IDs. " +
        "Use this for commands like 'delete all purple sticky notes', 'delete all rectangles', 'delete everything blue'. " +
        "Prefer this over delete_objects when the user refers to objects by color or type rather than by ID. " +
        "color can be a hex code (#A855F7) or a plain name (purple, yellow, pink, blue, green, orange, red, gray).",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["sticky", "rectangle", "circle", "line", "frame", "text"],
            description: "Only delete objects of this type. Omit to match all types.",
          },
          color: {
            type: "string",
            description:
              "Only delete objects with this color. Accepts a hex code OR a color name: " +
              "yellow (#FAD84E), pink (#F5A8C4), blue (#7FC8E8), green (#9DD9A3), " +
              "grey (#E5E5E0), offwhite (#F9F9F7), red (#CC0000), black (#111111).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_connectors",
      description: "Delete one or more connectors from the board by their IDs.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of connector IDs to delete",
          },
        },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_objects_by_filter",
      description:
        "Update all objects matching a color and/or type filter without needing to know their IDs. " +
        "Use this for commands like 'make all yellow stickies green', 'resize all rectangles', " +
        "'rename all blue notes to Done'. Prefer this over update_objects when the user refers " +
        "to objects by color or type rather than by specific ID.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "object",
            description: "Criteria to match objects. At least one field required.",
            properties: {
              type: {
                type: "string",
                enum: ["sticky", "rectangle", "circle", "line", "frame", "text"],
                description: "Only match objects of this type.",
              },
              color: {
                type: "string",
                description: "Only match objects with this color (hex or name: purple, yellow, etc.).",
              },
            },
          },
          updates: {
            type: "object",
            description: "Fields to apply to every matched object.",
            properties: {
              color:    { type: "string", description: "New color (hex or name)." },
              text:     { type: "string", description: "New text content." },
              width:    { type: "number" },
              height:   { type: "number" },
              rotation: { type: "number" },
            },
          },
        },
        required: ["filter", "updates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fit_frames_to_contents",
      description:
        "Resize one or more frames so they tightly wrap all objects inside them. " +
        "Pass frame IDs, or omit ids to fit ALL frames on the board. " +
        "Nested frames are supported and fit inside-out automatically. " +
        "Use after adding or moving objects inside a frame, or when the user says " +
        "'resize the frame to fit', 'tighten the frame', 'fit contents'.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Frame IDs to fit. Omit or pass [] to fit all frames.",
          },
          padding: {
            type: "number",
            description: "Extra space (px) around contents on each side. Default: 40. Top gets an extra 30px for the frame title.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_board",
      description:
        "Delete ALL objects and connectors from the board. Use only when the user explicitly asks " +
        "to clear, wipe, or start fresh. This is irreversible.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to_objects",
      description:
        "Pan and zoom the user's camera so the given objects are centered and visible on screen. " +
        "Use when the user says 'show me', 'go to', 'zoom to', 'find', 'where is', 'navigate to', " +
        "'take me to', or 'focus on'. Pass ids to navigate to specific objects, or omit to fit the entire board.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Object IDs to navigate to. Omit or pass [] to fit all objects on the board.",
          },
          padding: {
            type: "number",
            description: "Fraction of screen to use as margin (0–1, default 0.82).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "arrange_objects",
      description:
        "Align or distribute objects geometrically. Pass object IDs, or omit ids to use the currently selected objects. " +
        "Use when the user says 'align', 'distribute', 'space evenly', 'make a grid', 'line up', 'organize'.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Object IDs to arrange. Omit to use current selection.",
          },
          operation: {
            type: "string",
            enum: [
              "align-left", "align-right", "align-center-x",
              "align-top",  "align-bottom", "align-center-y",
              "distribute-horizontal", "distribute-vertical",
              "grid",
            ],
            description:
              "align-left/right/center-x: snap left/right/center edges. " +
              "align-top/bottom/center-y: snap top/bottom/center edges. " +
              "distribute-horizontal/vertical: spread objects with equal gaps. " +
              "grid: arrange in a grid.",
          },
          columns: {
            type: "number",
            description: "Number of columns for grid layout (default: ceil(sqrt(n))).",
          },
          gap: {
            type: "number",
            description: "Pixel gap between objects for grid/distribute (default: 20).",
          },
        },
        required: ["operation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_objects",
      description:
        "Clone one or more objects (and any connectors between them) with a position offset. " +
        "Use when the user says 'duplicate', 'copy', 'clone', 'make another one like that'. " +
        "Pass ids, or omit to duplicate the currently selected objects. Returns the new object IDs.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Object IDs to duplicate. Omit to use current selection.",
          },
          offsetX: { type: "number", description: "Horizontal offset for copies (default: 20)." },
          offsetY: { type: "number", description: "Vertical offset for copies (default: 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_objects",
      description:
        "Find objects on the board by text content, type, or color. Returns matching object IDs and properties. " +
        "Use when the user says 'find', 'search for', 'which objects have', 'show me all', or before acting on " +
        "objects you need to locate first.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Search for objects whose text contains this string (case-insensitive).",
          },
          type: {
            type: "string",
            enum: ["sticky", "rectangle", "circle", "line", "frame", "text"],
            description: "Only return objects of this type.",
          },
          color: {
            type: "string",
            description: "Only return objects of this color (hex or name).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_board_state",
      description:
        "Read the current state of the board — all objects and connectors. Use this to verify your changes, find object IDs, or understand the current layout before making modifications.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// ─── Color name ↔ hex mapping (matches src/utils/colors.ts) ─────

const COLOR_NAME_TO_HEX: Record<string, string> = {
  yellow:   "#FAD84E",
  pink:     "#F5A8C4",
  blue:     "#7FC8E8",
  green:    "#9DD9A3",
  grey:     "#E5E5E0",
  gray:     "#E5E5E0",
  offwhite: "#F9F9F7",
  red:      "#CC0000",
  black:    "#111111",
  darkgrey: "#404040",
  white:    "#FFFFFF",
  "light gray": "#E5E5E0",
  "light grey": "#E5E5E0",
};

const HEX_TO_COLOR_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(COLOR_NAME_TO_HEX).map(([name, hex]) => [hex.toLowerCase(), name])
);

/** Resolve a user-supplied color string to a hex code. */
function resolveColor(input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (lower.startsWith("#")) return lower; // already hex
  return COLOR_NAME_TO_HEX[lower] ?? null;
}

/** Return a human-readable label for a hex color. */
export function colorLabel(hex: string): string {
  return HEX_TO_COLOR_NAME[hex.toLowerCase()] ?? hex;
}

// ─── Defaults ──────────────────────────────────────────────────

const TYPE_DEFAULTS: Record<string, { width: number; height: number; color: string }> = {
  sticky:    { width: 150, height: 150, color: "#FAD84E" },
  rectangle: { width: 200, height: 150, color: "#111111" },
  circle:    { width: 120, height: 120, color: "#111111" },
  text:      { width: 200, height: 50, color: "#111111" },
  frame:     { width: 400, height: 300, color: "#F9F9F7" },
};

const PATCH_BULK_CHUNK_SIZE = 200;

function applyPatchToObjectRow(existingRow: any, patch: Record<string, any>, now: string) {
  const row = { ...existingRow };

  if (patch.x !== undefined) row.x = patch.x;
  if (patch.y !== undefined) row.y = patch.y;
  if (patch.width !== undefined) row.width = patch.width;
  if (patch.height !== undefined) row.height = patch.height;
  if (patch.color !== undefined) row.color = resolveColor(patch.color) ?? patch.color;
  if (patch.text !== undefined) row.text = patch.text;
  if (patch.rotation !== undefined) row.rotation = patch.rotation;
  if (patch.parentFrameId !== undefined) {
    row.parent_frame_id = patch.parentFrameId || null;
  }

  row.updated_at = now;
  return row;
}

async function applyObjectPatchesFallback(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boardId: string,
  patches: any[],
  now: string
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }>; succeeded: number }> {
  const results = await Promise.all(
    patches.map(async (patch: any) => {
      const { id, ...updates } = patch;
      if (!id) {
        return {
          id: "",
          ok: false,
          error: "Missing object id",
        } as { id: string; ok: boolean; error?: string };
      }

      const row: Record<string, any> = {};
      if (updates.x !== undefined) row.x = updates.x;
      if (updates.y !== undefined) row.y = updates.y;
      if (updates.width !== undefined) row.width = updates.width;
      if (updates.height !== undefined) row.height = updates.height;
      if (updates.color !== undefined) row.color = resolveColor(updates.color) ?? updates.color;
      if (updates.text !== undefined) row.text = updates.text;
      if (updates.rotation !== undefined) row.rotation = updates.rotation;
      if (updates.parentFrameId !== undefined) {
        row.parent_frame_id = updates.parentFrameId || null;
      }
      row.updated_at = now;

      const { error } = await supabase
        .from("objects")
        .update(row)
        .eq("id", id)
        .eq("board_id", boardId);

      return { id, ok: !error, error: error?.message } as {
        id: string;
        ok: boolean;
        error?: string;
      };
    })
  );

  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
  };
}

/**
 * Apply object patches with a fast bulk path (single upsert per chunk) and a
 * per-object fallback for exact compatibility when bulk fails.
 */
async function applyObjectPatches(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boardId: string,
  patches: any[],
  now: string
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }>; succeeded: number }> {
  if (patches.length === 0) return { results: [], succeeded: 0 };

  const patchIds = Array.from(
    new Set(
      patches
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  if (patchIds.length === 0) {
    return applyObjectPatchesFallback(supabase, boardId, patches, now);
  }

  try {
    const existingRows: any[] = [];
    for (let i = 0; i < patchIds.length; i += PATCH_BULK_CHUNK_SIZE) {
      const idChunk = patchIds.slice(i, i + PATCH_BULK_CHUNK_SIZE);
      const { data, error: fetchError } = await supabase
        .from("objects")
        .select("*")
        .eq("board_id", boardId)
        .in("id", idChunk);

      if (fetchError) {
        throw fetchError;
      }

      if (data?.length) existingRows.push(...data);
    }

    const existingById = new Map(existingRows.map((row: any) => [row.id, row]));
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    const upsertRows: any[] = [];

    for (const patch of patches) {
      const id = patch?.id;
      if (!id || typeof id !== "string") {
        results.push({ id: "", ok: false, error: "Missing object id" });
        continue;
      }

      const existing = existingById.get(id);
      if (!existing) {
        // Preserve old behavior: updating a non-existent row is treated as a
        // no-error no-op.
        results.push({ id, ok: true });
        continue;
      }

      upsertRows.push(applyPatchToObjectRow(existing, patch, now));
      results.push({ id, ok: true });
    }

    for (let i = 0; i < upsertRows.length; i += PATCH_BULK_CHUNK_SIZE) {
      const chunk = upsertRows.slice(i, i + PATCH_BULK_CHUNK_SIZE);
      if (chunk.length === 0) continue;

      const { error } = await supabase
        .from("objects")
        .upsert(chunk, { onConflict: "id" });

      if (error) throw error;
    }

    return {
      results,
      succeeded: results.filter((r) => r.ok).length,
    };
  } catch {
    return applyObjectPatchesFallback(supabase, boardId, patches, now);
  }
}

// ─── Tool Execution ────────────────────────────────────────────

export interface ToolResult {
  name: string;
  result: unknown;
}

interface ToolContext {
  screenSize?: { width: number; height: number };
  selectedIds?: string[];
}

/**
 * Execute a single tool call against the database.
 * Returns a JSON-serializable result for the LLM.
 * Results with a `_viewport` key signal the agent to emit a navigate event.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  boardId: string,
  userId: string,
  context: ToolContext = {},
  openaiApiKey?: string
): Promise<unknown> {
  const supabase = getSupabaseAdmin();

  switch (toolName) {
    // ── Create Objects ────────────────────────────────────
    case "create_objects": {
      const objects: any[] = args.objects || [];
      const now = new Date().toISOString();
      // Use Date.now() as the z_index base — always larger than any sequential
      // counter that was used before, and monotonically increasing across calls.
      // Adding the loop index ensures correct stacking within a single batch.
      // This eliminates a SELECT round-trip (getMaxZIndex) on every create.
      const baseZIndex = Date.now();
      const createdIds: string[] = [];

      // Build rows for batch insert
      const rows = objects.map((obj: any, i: number) => {
        const defaults = TYPE_DEFAULTS[obj.type] || TYPE_DEFAULTS.rectangle;
        return {
          board_id: boardId,
          type: obj.type,
          x: obj.x ?? 0,
          y: obj.y ?? 0,
          width: obj.width ?? defaults.width,
          height: obj.height ?? defaults.height,
          color: (obj.color ? resolveColor(obj.color) : null) || defaults.color,
          text: obj.text ?? "",
          rotation: obj.rotation ?? 0,
          z_index: baseZIndex + i,
          created_by: userId,
          parent_frame_id: obj.parentFrameId || null,
          created_at: now,
          updated_at: now,
        };
      });

      // Batch insert — single roundtrip
      const { data, error } = await supabase
        .from("objects")
        .insert(rows)
        .select("id");

      if (error) {
        return { error: error.message };
      }

      for (const row of data || []) {
        createdIds.push(row.id);
      }

      return {
        created: createdIds.length,
        ids: createdIds,
        message: `Created ${createdIds.length} object(s)`,
      };
    }

    // ── Bulk Create Objects ─────────────────────────────
    case "bulk_create_objects": {
      const objType: string = args.type || "sticky";
      const count: number = Math.min(Math.max(args.count || 0, 1), 500);
      const layout: string = args.layout || "grid";
      const gap: number = args.gap ?? 20;
      let startX: number = args.startX ?? 100;
      let startY: number = args.startY ?? 100;
      const contentPrompt: string | undefined = args.contentPrompt;
      const textPattern: string | undefined = args.textPattern;
      const parentFrameId: string | null = args.parentFrameId || null;

      const defaults = TYPE_DEFAULTS[objType] || TYPE_DEFAULTS.rectangle;
      const objWidth: number = args.width ?? defaults.width;
      const objHeight: number = args.height ?? defaults.height;
      const color: string = (args.color ? resolveColor(args.color) : null) || defaults.color;

      // Automatically compute placement inside the parent frame if provided
      if (parentFrameId) {
        const { data: frameAndKids } = await supabase
          .from("objects")
          .select("id, type, x, y, width, height")
          .eq("board_id", boardId)
          .or(`id.eq.${parentFrameId},parent_frame_id.eq.${parentFrameId}`);
        
        if (frameAndKids && frameAndKids.length > 0) {
          const frame = frameAndKids.find((o: any) => o.id === parentFrameId);
          const kids = frameAndKids.filter((o: any) => o.id !== parentFrameId);
          
          if (frame) {
            startX = frame.x + 30; // 30px padding from left edge
            if (kids.length > 0) {
              // Place below the lowest existing child
              const maxY = Math.max(...kids.map((k: any) => k.y + k.height));
              startY = maxY + gap;
            } else {
              // Place near the top, leaving room for the frame title
              startY = frame.y + 60;
            }
          }
        }
      }

      // Compute columns for grid layout
      const columns: number =
        layout === "vertical" ? 1
        : layout === "horizontal" ? count
        : args.columns ?? Math.ceil(Math.sqrt(count));

      // Generate positions
      const positions: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < count; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        positions.push({
          x: startX + col * (objWidth + gap),
          y: startY + row * (objHeight + gap),
        });
      }

      // Generate text content
      let texts: string[] = [];
      if (contentPrompt && openaiApiKey) {
        // Server-side LLM call for unique content
        try {
          const openai = new OpenAI({ apiKey: openaiApiKey });
          const resp = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            temperature: 0.9,
            max_tokens: Math.min(count * 60, 16000),
            messages: [
              {
                role: "system",
                content:
                  "You generate short text items. Return ONLY a JSON array of strings, no other text. " +
                  "Each string should be concise (under 80 characters). No numbering or prefixes.",
              },
              {
                role: "user",
                content: `Generate exactly ${count} unique items. Each item should be: ${contentPrompt}`,
              },
            ],
          });

          const raw = resp.choices[0]?.message?.content?.trim() ?? "[]";
          // Strip markdown code fences if present
          const jsonStr = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
          try {
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
              texts = parsed.map((item: any) => String(item));
            }
          } catch {
            // If JSON parsing fails, split by newlines as fallback
            texts = raw
              .split("\n")
              .map((line: string) => line.replace(/^\d+[\.\)]\s*/, "").trim())
              .filter((line: string) => line.length > 0);
          }
        } catch (err: any) {
          // If LLM call fails, fall back to pattern or empty
          texts = [];
        }
      }

      if (texts.length === 0 && textPattern) {
        texts = Array.from({ length: count }, (_, i) =>
          textPattern.replace(/\{i\}/g, String(i + 1))
        );
      }

      // Pad or truncate texts to match count
      while (texts.length < count) {
        texts.push(texts.length > 0 ? "" : "");
      }

      const now = new Date().toISOString();
      const baseZIndex = Date.now();

      const rows = positions.map((pos, i) => ({
        board_id: boardId,
        type: objType,
        x: pos.x,
        y: pos.y,
        width: objWidth,
        height: objHeight,
        color,
        text: texts[i] ?? "",
        rotation: 0,
        z_index: baseZIndex + i,
        created_by: userId,
        parent_frame_id: parentFrameId,
        created_at: now,
        updated_at: now,
      }));

      const { data, error } = await supabase
        .from("objects")
        .insert(rows)
        .select("id");

      if (error) {
        return { error: error.message };
      }

      const createdIds = (data || []).map((r: any) => r.id);
      return {
        created: createdIds.length,
        ids: createdIds,
        message: `Bulk-created ${createdIds.length} ${objType} object(s)`,
      };
    }

    // ── Create Quadrant Layout ────────────────────────────
    case "createQuadrant": {
      const { title, xAxisLabel, yAxisLabel, quadrantLabels, items } = args;
      const startX = args.startX ?? 100;
      const startY = args.startY ?? 100;
      const now = new Date().toISOString();
      let zIndex = Date.now();
      
      const tlItems: string[] = items?.topLeft || [];
      const trItems: string[] = items?.topRight || [];
      const blItems: string[] = items?.bottomLeft || [];
      const brItems: string[] = items?.bottomRight || [];

      const stickyWidth = 150;
      const stickyHeight = 150;
      const gap = 20;
      const quadrantPadding = 30;
      
      const getGridSize = (count: number) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
        const rows = Math.max(1, Math.ceil(count / cols));
        return { cols, rows };
      };

      const tlGrid = getGridSize(tlItems.length);
      const trGrid = getGridSize(trItems.length);
      const blGrid = getGridSize(blItems.length);
      const brGrid = getGridSize(brItems.length);

      const maxTopRows = Math.max(tlGrid.rows, trGrid.rows);
      const maxBottomRows = Math.max(blGrid.rows, brGrid.rows);
      const maxLeftCols = Math.max(tlGrid.cols, blGrid.cols);
      const maxRightCols = Math.max(trGrid.cols, brGrid.cols);

      const qWidthLeft = Math.max(maxLeftCols * stickyWidth + (maxLeftCols - 1) * gap + quadrantPadding * 2, 300);
      const qWidthRight = Math.max(maxRightCols * stickyWidth + (maxRightCols - 1) * gap + quadrantPadding * 2, 300);
      const qHeightTop = Math.max(maxTopRows * stickyHeight + (maxTopRows - 1) * gap + quadrantPadding * 2 + 60, 300); // +60 for inner title
      const qHeightBottom = Math.max(maxBottomRows * stickyHeight + (maxBottomRows - 1) * gap + quadrantPadding * 2 + 60, 300);

      const totalWidth = qWidthLeft + qWidthRight + gap;
      const totalHeight = qHeightTop + qHeightBottom + gap;

      const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, totalHeight + 80, startX, startY);

      let parentFrameId: string | null = null;
      let totalCreated = 0;
      const quadrantIds: Record<string, string> = {};

      // Insert master frame first
      const { data: masterData, error: masterErr } = await supabase
        .from("objects")
        .insert({
          board_id: boardId,
          type: "frame",
          x: pos.x,
          y: pos.y,
          width: totalWidth + 40,
          height: totalHeight + 80,
          color: "#F9F9F7",
          text: title || "Quadrant Layout",
          rotation: 0,
          z_index: zIndex++,
          created_by: userId,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (masterErr || !masterData) return { error: masterErr?.message || "Failed to create master frame" };
      parentFrameId = masterData.id;
      totalCreated++;

      const children: any[] = [];
      if (xAxisLabel) {
        children.push({
          board_id: boardId, type: "text",
          x: pos.x + (totalWidth + 40) / 2 - 100, y: pos.y + totalHeight + 80 - 40,
          width: 200, height: 40, text: xAxisLabel,
          color: "#111111", parent_frame_id: parentFrameId, rotation: 0,
          z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
        });
      }
      if (yAxisLabel) {
        children.push({
          board_id: boardId, type: "text",
          x: pos.x - 60, y: pos.y + (totalHeight + 80) / 2 - 100,
          width: 200, height: 40, text: yAxisLabel,
          color: "#111111", parent_frame_id: parentFrameId, rotation: -90,
          z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
        });
      }
      if (children.length > 0) {
        const { error: childErr } = await supabase.from("objects").insert(children);
        if (childErr) return { error: childErr.message };
        totalCreated += children.length;
      }

      // Helper to generate quadrant frames + stickies
      const buildQuadrant = async (qTitle: string, qItems: string[], qX: number, qY: number, qWidth: number, qHeight: number, color: string, qCols: number, key: string) => {
        const { data: qData, error: qErr } = await supabase
          .from("objects")
          .insert({
            board_id: boardId, type: "frame",
            x: qX, y: qY, width: qWidth, height: qHeight,
            color: "#F9F9F7", text: qTitle || key,
            parent_frame_id: parentFrameId, rotation: 0,
            z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
          })
          .select("id")
          .single();

        if (qErr || !qData) throw new Error(qErr?.message || "Failed to create quadrant frame");
        const qFrameId = qData.id;
        quadrantIds[key] = qFrameId;
        totalCreated++;

        if (qItems.length > 0) {
          const stickyRows = qItems.map((itemText, i) => {
            const col = i % qCols;
            const row = Math.floor(i / qCols);
            return {
              board_id: boardId, type: "sticky",
              x: qX + quadrantPadding + col * (stickyWidth + gap),
              y: qY + 60 + row * (stickyHeight + gap), // +60 for quadrant title
              width: stickyWidth, height: stickyHeight, text: itemText,
              color, parent_frame_id: qFrameId, rotation: 0,
              z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
            };
          });
          const { error: stickyErr } = await supabase.from("objects").insert(stickyRows);
          if (stickyErr) throw new Error(stickyErr.message);
          totalCreated += stickyRows.length;
        }
      };

      try {
        const startInnerX = pos.x + 20;
        const startInnerY = pos.y + 60;
        
        await buildQuadrant(quadrantLabels?.topLeft, tlItems, startInnerX, startInnerY, qWidthLeft, qHeightTop, "#9DD9A3", tlGrid.cols, "topLeft");
        await buildQuadrant(quadrantLabels?.topRight, trItems, startInnerX + qWidthLeft + gap, startInnerY, qWidthRight, qHeightTop, "#FAD84E", trGrid.cols, "topRight");
        await buildQuadrant(quadrantLabels?.bottomLeft, blItems, startInnerX, startInnerY + qHeightTop + gap, qWidthLeft, qHeightBottom, "#7FC8E8", blGrid.cols, "bottomLeft");
        await buildQuadrant(quadrantLabels?.bottomRight, brItems, startInnerX + qWidthLeft + gap, startInnerY + qHeightTop + gap, qWidthRight, qHeightBottom, "#F5A8C4", brGrid.cols, "bottomRight");
      } catch (err: any) {
        return { error: err.message };
      }

      return {
        created: totalCreated,
        frameId: parentFrameId,
        quadrantIds,
        message: `Created quadrant layout with ${totalCreated} objects.`,
      };
    }

    // ── Create Column Layout ────────────────────────────
    case "createColumnLayout": {
      const { title, columns } = args;
      if (!Array.isArray(columns) || columns.length === 0) {
        return { error: "columns array is required and cannot be empty" };
      }

      const startX = args.startX ?? 100;
      const startY = args.startY ?? 100;
      const now = new Date().toISOString();
      let zIndex = Date.now();

      const stickyWidth = 150;
      const stickyHeight = 150;
      const gap = 20;
      const colPadding = 30;

      const maxItems = Math.max(...columns.map((c: any) => Array.isArray(c.items) ? c.items.length : 0));
      const colWidth = stickyWidth + colPadding * 2;
      const totalWidth = columns.length * (colWidth + gap) - gap;
      const colHeight = Math.max(maxItems * stickyHeight + (maxItems > 0 ? (maxItems - 1) * gap : 0) + colPadding * 2 + 60, 300);

      const pos = await findOpenCanvasSpace(boardId, totalWidth, colHeight, startX, startY);

      const colors = ["#E5E5E0", "#7FC8E8", "#FAD84E", "#9DD9A3", "#F5A8C4"];
      let parentFrameId: string | null = null;
      let totalCreated = 0;
      const columnIds: Record<string, string> = {};

      // Insert master frame first if title is provided
      if (title) {
        const { data: masterData, error: masterErr } = await supabase
          .from("objects")
          .insert({
            board_id: boardId, type: "frame",
            x: pos.x, y: pos.y,
            width: totalWidth + 40, height: colHeight + 80,
            color: "#F9F9F7", text: title, rotation: 0,
            z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
          })
          .select("id")
          .single();

        if (masterErr || !masterData) return { error: masterErr?.message || "Failed to create master frame" };
        parentFrameId = masterData.id;
        totalCreated++;
      }

      // Insert each column frame, then its children
      for (let colIdx = 0; colIdx < columns.length; colIdx++) {
        const col = columns[colIdx];
        const cx = pos.x + 20 + colIdx * (colWidth + gap);
        const cy = pos.y + 60;
        const color = colors[colIdx % colors.length];

        const { data: colData, error: colErr } = await supabase
          .from("objects")
          .insert({
            board_id: boardId, type: "frame",
            x: cx, y: cy, width: colWidth, height: colHeight,
            color: "#F9F9F7", text: col.title || `Column ${colIdx + 1}`,
            parent_frame_id: parentFrameId,
            rotation: 0, z_index: zIndex++,
            created_by: userId, created_at: now, updated_at: now,
          })
          .select("id")
          .single();

        if (colErr || !colData) return { error: colErr?.message || "Failed to create column frame" };
        const colFrameId = colData.id;
        columnIds[col.title || `Column ${colIdx + 1}`] = colFrameId;
        totalCreated++;

        const items: string[] = Array.isArray(col.items) ? col.items : [];
        if (items.length > 0) {
          const stickyRows = items.map((itemText: string, i: number) => ({
            board_id: boardId, type: "sticky",
            x: cx + colPadding, y: cy + 60 + i * (stickyHeight + gap),
            width: stickyWidth, height: stickyHeight, text: itemText,
            color, parent_frame_id: colFrameId, rotation: 0,
            z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
          }));
          const { error: stickyErr } = await supabase.from("objects").insert(stickyRows);
          if (stickyErr) return { error: stickyErr.message };
          totalCreated += stickyRows.length;
        }
      }

      return {
        created: totalCreated,
        frameId: parentFrameId ?? undefined,
        columnIds,
        message: `Created column layout with ${totalCreated} objects.`,
      };
    }

    // ── Create Connectors ────────────────────────────────
    case "create_connectors": {
      const connectors: any[] = args.connectors || [];
      const rows = connectors.map((conn: any) => ({
        board_id: boardId,
        from_id: conn.fromId || null,
        to_id: conn.toId || null,
        style: conn.style || "arrow",
        from_point: conn.fromPoint ?? null,
        to_point: conn.toPoint ?? null,
        color: (conn.color ? resolveColor(conn.color) : null) ?? null,
        stroke_width: conn.strokeWidth ?? null,
      }));

      const { data, error } = await supabase
        .from("connectors")
        .insert(rows)
        .select("id");

      if (error) {
        return { error: error.message };
      }

      const ids = (data || []).map((r: any) => r.id);
      return {
        created: ids.length,
        ids,
        message: `Created ${ids.length} connector(s)`,
      };
    }

    // ── Update Objects ───────────────────────────────────
    case "update_objects": {
      const patches: any[] = args.patches || [];
      const now = new Date().toISOString();

      const { results, succeeded } = await applyObjectPatches(
        supabase,
        boardId,
        patches,
        now
      );

      return {
        updated: succeeded,
        results,
        message: `Updated ${succeeded}/${patches.length} object(s)`,
      };
    }

    // ── Delete Objects ───────────────────────────────────
    case "delete_objects": {
      const ids: string[] = args.ids || [];

      // Also clean up connectors that reference these objects
      if (ids.length > 0) {
        await supabase
          .from("connectors")
          .delete()
          .eq("board_id", boardId)
          .or(ids.map((id) => `from_id.eq.${id}`).join(",") + "," + ids.map((id) => `to_id.eq.${id}`).join(","));
      }

      const { error } = await supabase
        .from("objects")
        .delete()
        .eq("board_id", boardId)
        .in("id", ids);

      if (error) {
        return { error: error.message };
      }

      return { deleted: ids.length, message: `Deleted ${ids.length} object(s)` };
    }

    // ── Delete by filter ────────────────────────────────
    case "delete_objects_by_filter": {
      const filterType: string | undefined = args.type;
      const filterColor: string | undefined = args.color;

      if (!filterType && !filterColor) {
        return { error: "Provide at least one of: type, color" };
      }

      // Resolve color name → hex
      let hexColor: string | null = null;
      if (filterColor) {
        hexColor = resolveColor(filterColor);
        if (!hexColor) {
          return { error: `Unrecognised color "${filterColor}". Use a name (purple, yellow…) or hex (#A855F7).` };
        }
      }

      // Build query
      let query = supabase
        .from("objects")
        .select("id")
        .eq("board_id", boardId);

      if (filterType) query = query.eq("type", filterType);
      if (hexColor)   query = query.ilike("color", hexColor); // case-insensitive hex match

      const { data: matches, error: selErr } = await query;
      if (selErr) return { error: selErr.message };

      const ids = (matches || []).map((r: any) => r.id);
      if (ids.length === 0) {
        const desc = [filterType, filterColor ? `${filterColor} (${hexColor})` : null]
          .filter(Boolean).join(" ");
        return { deleted: 0, message: `No ${desc} objects found on the board.` };
      }

      // Clean up attached connectors
      await supabase
        .from("connectors")
        .delete()
        .eq("board_id", boardId)
        .or(
          ids.map((id: string) => `from_id.eq.${id}`).join(",") +
          "," +
          ids.map((id: string) => `to_id.eq.${id}`).join(",")
        );

      const { error: delErr } = await supabase
        .from("objects")
        .delete()
        .eq("board_id", boardId)
        .in("id", ids);

      if (delErr) return { error: delErr.message };

      return { deleted: ids.length, message: `Deleted ${ids.length} object(s).` };
    }

    // ── Delete Connectors ────────────────────────────────
    case "delete_connectors": {
      const ids: string[] = args.ids || [];

      const { error } = await supabase
        .from("connectors")
        .delete()
        .eq("board_id", boardId)
        .in("id", ids);

      if (error) {
        return { error: error.message };
      }

      return { deleted: ids.length, message: `Deleted ${ids.length} connector(s)` };
    }

    // ── Update by filter ─────────────────────────────────
    case "update_objects_by_filter": {
      const filter = args.filter || {};
      const updates = args.updates || {};

      if (!filter.type && !filter.color) {
        return { error: "filter must include at least one of: type, color" };
      }
      if (Object.keys(updates).length === 0) {
        return { error: "updates must include at least one field to change" };
      }

      let hexFilter: string | null = null;
      if (filter.color) {
        hexFilter = resolveColor(filter.color);
        if (!hexFilter) return { error: `Unrecognised color "${filter.color}"` };
      }

      let query = supabase.from("objects").select("id").eq("board_id", boardId);
      if (filter.type)  query = query.eq("type", filter.type);
      if (hexFilter)    query = query.ilike("color", hexFilter);

      const { data: matches, error: selErr } = await query;
      if (selErr) return { error: selErr.message };

      const ids = (matches || []).map((r: any) => r.id);
      if (ids.length === 0) return { updated: 0, message: "No matching objects found." };

      // Build DB row from updates
      const row: Record<string, any> = { updated_at: new Date().toISOString() };
      if (updates.color !== undefined) {
        row.color = resolveColor(updates.color) ?? updates.color;
      }
      if (updates.text     !== undefined) row.text     = updates.text;
      if (updates.width    !== undefined) row.width    = updates.width;
      if (updates.height   !== undefined) row.height   = updates.height;
      if (updates.rotation !== undefined) row.rotation = updates.rotation;

      const { error: updErr } = await supabase
        .from("objects")
        .update(row)
        .eq("board_id", boardId)
        .in("id", ids);

      if (updErr) return { error: updErr.message };
      return { updated: ids.length, message: `Updated ${ids.length} object(s).` };
    }

    // ── Fit frames to contents ────────────────────────────
    case "fit_frames_to_contents": {
      const padding: number = args.padding ?? 40;
      const TITLE_EXTRA = 30; // extra top padding for the frame title label

      // Resolve which frames to fit
      let frameIds: string[] = args.ids ?? [];
      if (frameIds.length === 0) {
        const { data } = await supabase
          .from("objects")
          .select("id")
          .eq("board_id", boardId)
          .eq("type", "frame");
        frameIds = (data || []).map((r: any) => r.id);
      }
      if (frameIds.length === 0) return { message: "No frames found on the board." };

      // Fetch ALL objects to correctly compute nested bounding boxes and inside-out updates
      const { data: allObjects } = await supabase
        .from("objects")
        .select("id, type, x, y, width, height, parent_frame_id")
        .eq("board_id", boardId);
        
      const objects = allObjects || [];
      const objMap = new Map(objects.map(o => [o.id, o]));
      
      // Group children by parent
      const childrenByParent = new Map<string, any[]>();
      for (const obj of objects) {
        if (obj.parent_frame_id) {
          if (!childrenByParent.has(obj.parent_frame_id)) childrenByParent.set(obj.parent_frame_id, []);
          childrenByParent.get(obj.parent_frame_id)!.push(obj);
        }
      }

      // Determine depth of each frame for inside-out processing
      const getDepth = (id: string, visited = new Set<string>()): number => {
        if (visited.has(id)) return 0; // prevent cycles
        visited.add(id);
        const obj = objMap.get(id);
        if (!obj || !obj.parent_frame_id) return 0;
        return 1 + getDepth(obj.parent_frame_id, visited);
      };

      const framesToFit = frameIds
        .map(id => ({ id, depth: getDepth(id) }))
        .sort((a, b) => b.depth - a.depth); // Deepest first (inside-out)

      const now = new Date().toISOString();
      let fittedCount = 0;
      let skippedCount = 0;

      // Process sequentially inside-out so parent frames can wrap their newly-resized children
      for (const { id: frameId } of framesToFit) {
        const kids = childrenByParent.get(frameId) || [];
        if (kids.length === 0) {
          skippedCount++;
          continue;
        }

        // Get the CURRENT state of kids from objMap (which we update dynamically)
        const currentKids = kids.map(k => objMap.get(k.id)!);

        const minX = Math.min(...currentKids.map(c => c.x));
        const minY = Math.min(...currentKids.map(c => c.y));
        const maxX = Math.max(...currentKids.map(c => c.x + c.width));
        const maxY = Math.max(...currentKids.map(c => c.y + c.height));

        const newX      = minX - padding;
        const newY      = minY - padding - TITLE_EXTRA;
        const newWidth  = (maxX - minX) + padding * 2;
        const newHeight = (maxY - minY) + padding * 2 + TITLE_EXTRA;

        // Update DB
        await supabase
          .from("objects")
          .update({ x: newX, y: newY, width: newWidth, height: newHeight, updated_at: now })
          .eq("id", frameId);
          
        // Update local map so parent frames see the new size
        const frameObj = objMap.get(frameId);
        if (frameObj) {
          frameObj.x = newX;
          frameObj.y = newY;
          frameObj.width = newWidth;
          frameObj.height = newHeight;
        }
        
        fittedCount++;
      }

      let msg = `Fitted ${fittedCount}/${frameIds.length} frame(s).`;
      if (skippedCount > 0) {
        msg += ` Skipped ${skippedCount} frame(s) because they had no children.`;
      }
      return { fitted: fittedCount, skipped: skippedCount, total: frameIds.length, message: msg };
    }

    // ── Clear board ───────────────────────────────────────
    case "clear_board": {
      const { error: cErr } = await supabase
        .from("connectors")
        .delete()
        .eq("board_id", boardId);
      if (cErr) return { error: cErr.message };

      const { error: oErr } = await supabase
        .from("objects")
        .delete()
        .eq("board_id", boardId);
      if (oErr) return { error: oErr.message };

      return { message: "Board cleared." };
    }

    // ── Navigate to objects ───────────────────────────────
    case "navigate_to_objects": {
      const targetIds: string[] | undefined = args.ids?.length ? args.ids : undefined;

      let query = supabase
        .from("objects")
        .select("x, y, width, height")
        .eq("board_id", boardId);
      if (targetIds) query = query.in("id", targetIds);

      const { data: objs } = await query;
      if (!objs || objs.length === 0) return { error: "No objects found to navigate to." };

      const minX = Math.min(...objs.map((o: any) => o.x));
      const minY = Math.min(...objs.map((o: any) => o.y));
      const maxX = Math.max(...objs.map((o: any) => o.x + o.width));
      const maxY = Math.max(...objs.map((o: any) => o.y + o.height));

      const boxW = Math.max(maxX - minX, 1);
      const boxH = Math.max(maxY - minY, 1);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const sw = context.screenSize?.width  ?? 1280;
      const sh = context.screenSize?.height ?? 800;
      const pad = args.padding ?? 0.82;

      const scale = Math.min(
        Math.max(Math.min((sw * pad) / boxW, (sh * pad) / boxH), 0.1),
        2.0
      );

      const viewport = {
        x: Math.round(sw / 2 - centerX * scale),
        y: Math.round(sh / 2 - centerY * scale),
        scale: Math.round(scale * 1000) / 1000,
      };

      return {
        _viewport: viewport,
        message: `Navigating to ${objs.length} object(s).`,
      };
    }

    // ── Arrange objects ───────────────────────────────────
    case "arrange_objects": {
      const rawIds: string[] | undefined = args.ids?.length
        ? args.ids
        : context.selectedIds?.length
        ? context.selectedIds
        : undefined;

      if (!rawIds || rawIds.length < 2) {
        return { error: "Need at least 2 object IDs. Pass ids or select objects first." };
      }

      const { data: objs } = await supabase
        .from("objects")
        .select("id, x, y, width, height")
        .eq("board_id", boardId)
        .in("id", rawIds);

      if (!objs || objs.length < 2) return { error: "Could not fetch enough objects to arrange." };

      const op: string = args.operation;
      const gap: number = args.gap ?? 20;
      const columns: number = args.columns ?? Math.ceil(Math.sqrt(objs.length));
      const now = new Date().toISOString();

      const patches: Array<{ id: string; x?: number; y?: number }> = [];

      switch (op) {
        case "align-left": {
          const anchor = Math.min(...objs.map((o: any) => o.x));
          for (const o of objs) patches.push({ id: o.id, x: anchor });
          break;
        }
        case "align-right": {
          const anchor = Math.max(...objs.map((o: any) => o.x + o.width));
          for (const o of objs) patches.push({ id: o.id, x: anchor - o.width });
          break;
        }
        case "align-center-x": {
          const anchor = objs.reduce((s: number, o: any) => s + o.x + o.width / 2, 0) / objs.length;
          for (const o of objs) patches.push({ id: o.id, x: Math.round(anchor - o.width / 2) });
          break;
        }
        case "align-top": {
          const anchor = Math.min(...objs.map((o: any) => o.y));
          for (const o of objs) patches.push({ id: o.id, y: anchor });
          break;
        }
        case "align-bottom": {
          const anchor = Math.max(...objs.map((o: any) => o.y + o.height));
          for (const o of objs) patches.push({ id: o.id, y: anchor - o.height });
          break;
        }
        case "align-center-y": {
          const anchor = objs.reduce((s: number, o: any) => s + o.y + o.height / 2, 0) / objs.length;
          for (const o of objs) patches.push({ id: o.id, y: Math.round(anchor - o.height / 2) });
          break;
        }
        case "distribute-horizontal": {
          const sorted = [...objs].sort((a: any, b: any) => a.x - b.x);
          const totalW = sorted.reduce((s: number, o: any) => s + o.width, 0);
          const span = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width - sorted[0].x;
          const spacing = Math.max((span - totalW) / (sorted.length - 1), gap);
          let curX = sorted[0].x;
          for (const o of sorted) {
            patches.push({ id: o.id, x: Math.round(curX) });
            curX += o.width + spacing;
          }
          break;
        }
        case "distribute-vertical": {
          const sorted = [...objs].sort((a: any, b: any) => a.y - b.y);
          const totalH = sorted.reduce((s: number, o: any) => s + o.height, 0);
          const span = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height - sorted[0].y;
          const spacing = Math.max((span - totalH) / (sorted.length - 1), gap);
          let curY = sorted[0].y;
          for (const o of sorted) {
            patches.push({ id: o.id, y: Math.round(curY) });
            curY += o.height + spacing;
          }
          break;
        }
        case "grid": {
          const startX = Math.min(...objs.map((o: any) => o.x));
          const startY = Math.min(...objs.map((o: any) => o.y));
          const cellW = Math.max(...objs.map((o: any) => o.width))  + gap;
          const cellH = Math.max(...objs.map((o: any) => o.height)) + gap;
          objs.forEach((o: any, i: number) => {
            patches.push({
              id: o.id,
              x: startX + (i % columns) * cellW,
              y: startY + Math.floor(i / columns) * cellH,
            });
          });
          break;
        }
        default:
          return { error: `Unknown operation "${op}".` };
      }

      await applyObjectPatches(supabase, boardId, patches, now);

      return { arranged: patches.length, message: `Applied ${op} to ${patches.length} object(s).` };
    }

    // ── Duplicate objects ─────────────────────────────────
    case "duplicate_objects": {
      const rawIds: string[] = args.ids?.length
        ? args.ids
        : context.selectedIds ?? [];

      if (rawIds.length === 0) {
        return { error: "No object IDs provided and nothing is selected." };
      }

      const offsetX: number = args.offsetX ?? 20;
      const offsetY: number = args.offsetY ?? 20;

      const { data: objs } = await supabase
        .from("objects")
        .select("*")
        .eq("board_id", boardId)
        .in("id", rawIds);

      if (!objs || objs.length === 0) return { error: "No matching objects found." };

      const baseZIndex = Date.now();
      const now = new Date().toISOString();

      // Pre-generate IDs so we can build the idMap and remap connectors
      const idMap: Record<string, string> = {};
      const newRows = objs.map((o: any, i: number) => {
        const newId = generateUUID();
        idMap[o.id] = newId;
        return {
          id: newId,
          board_id: boardId,
          type: o.type,
          x: o.x + offsetX,
          y: o.y + offsetY,
          width: o.width,
          height: o.height,
          color: o.color,
          text: o.text ?? "",
          text_size: o.text_size,
          text_color: o.text_color,
          text_vertical_align: o.text_vertical_align,
          rotation: o.rotation,
          z_index: baseZIndex + i,
          created_by: userId,
          parent_frame_id: o.parent_frame_id,
          points: o.points,
          stroke_width: o.stroke_width,
          created_at: now,
          updated_at: now,
        };
      });

      const { error: insErr } = await supabase.from("objects").insert(newRows);
      if (insErr) return { error: insErr.message };

      // Duplicate connectors where BOTH endpoints are in the duplicated set
      const { data: conns } = await supabase
        .from("connectors")
        .select("*")
        .eq("board_id", boardId)
        .in("from_id", rawIds)
        .in("to_id", rawIds);

      if (conns && conns.length > 0) {
        const newConns = conns.map((c: any) => ({
          board_id: boardId,
          from_id: idMap[c.from_id] ?? c.from_id,
          to_id:   idMap[c.to_id]   ?? c.to_id,
          style: c.style,
          from_point: c.from_point,
          to_point:   c.to_point,
          color:       c.color,
          stroke_width: c.stroke_width,
        }));
        await supabase.from("connectors").insert(newConns);
      }

      return {
        created: newRows.length,
        ids: Object.values(idMap),
        idMap,
        message: `Duplicated ${newRows.length} object(s).`,
      };
    }

    // ── Search objects ────────────────────────────────────
    case "search_objects": {
      const searchText:  string | undefined = args.text;
      const searchType:  string | undefined = args.type;
      const searchColor: string | undefined = args.color;

      if (!searchText && !searchType && !searchColor) {
        return { error: "Provide at least one of: text, type, color." };
      }

      let query = supabase
        .from("objects")
        .select("id, type, x, y, width, height, color, text, parent_frame_id")
        .eq("board_id", boardId);

      if (searchType)  query = query.eq("type", searchType);
      if (searchText)  query = query.ilike("text", `%${searchText}%`);
      if (searchColor) {
        const hex = resolveColor(searchColor) ?? searchColor;
        query = query.ilike("color", hex);
      }

      const { data: results, error } = await query;
      if (error) return { error: error.message };
      if (!results || results.length === 0) {
        return { found: 0, objects: [], message: "No matching objects found." };
      }

      return {
        found: results.length,
        objects: results.map((o: any) => ({
          id: o.id,
          type: o.type,
          text: o.text,
          color: colorLabel(o.color) !== o.color ? `${o.color} (${colorLabel(o.color)})` : o.color,
          x: o.x,
          y: o.y,
          parentFrameId: o.parent_frame_id,
        })),
        message: `Found ${results.length} matching object(s).`,
      };
    }

    // ── Read Board State ─────────────────────────────────
    case "read_board_state": {
      return await fetchBoardState(boardId);
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── Helpers ───────────────────────────────────────────────────


export async function findOpenCanvasSpace(boardId: string, reqWidth: number, reqHeight: number, startX = 100, startY = 100): Promise<{ x: number, y: number }> {
  const supabase = getSupabaseAdmin();
  const { data: objects } = await supabase
    .from("objects")
    .select("x, y, width, height")
    .eq("board_id", boardId);
  
  if (!objects || objects.length === 0) {
    return { x: startX, y: startY };
  }

  let testX = startX;
  let testY = startY;
  const padding = 50;

  // Simple brute-force scan: move right and down until no intersection
  while (true) {
    const intersects = objects.some(o => {
      return (
        testX < o.x + o.width + padding &&
        testX + reqWidth + padding > o.x &&
        testY < o.y + o.height + padding &&
        testY + reqHeight + padding > o.y
      );
    });

    if (!intersects) {
      return { x: testX, y: testY };
    }

    // Try moving right
    testX += reqWidth + padding;

    // Arbitrary wrap after moving 3000px right
    if (testX > startX + 3000) {
      testX = startX;
      testY += reqHeight + padding;
    }
  }
}

export async function fetchBoardState(boardId: string) {
  const supabase = getSupabaseAdmin();

  const [objRes, connRes] = await Promise.all([
    supabase.from("objects").select("*").eq("board_id", boardId),
    supabase.from("connectors").select("*").eq("board_id", boardId),
  ]);

  const objects = (objRes.data || []).map((row: any) => {
    const hex: string = row.color ?? "";
    const name = colorLabel(hex);
    // Include the human-readable name alongside the hex so the agent can
    // match user phrases like "purple" or "yellow" without guessing.
    const colorAnnotated = name !== hex ? `${hex} (${name})` : hex;
    return {
      id: row.id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      color: colorAnnotated,
      text: row.text || "",
      rotation: row.rotation,
      zIndex: row.z_index,
      parentFrameId: row.parent_frame_id || null,
    };
  });

  const connectors = (connRes.data || []).map((row: any) => ({
    id: row.id,
    fromId: row.from_id ?? "",
    toId: row.to_id ?? "",
    style: row.style,
    color: row.color ?? null,
    strokeWidth: row.stroke_width ?? null,
  }));

  return {
    objectCount: objects.length,
    connectorCount: connectors.length,
    objects,
    connectors,
  };
}
