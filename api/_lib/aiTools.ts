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
          quadrantSourceIds: {
            type: "object",
            properties: {
              topLeft: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the top-left quadrant" },
              topRight: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the top-right quadrant" },
              bottomLeft: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the bottom-left quadrant" },
              bottomRight: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the bottom-right quadrant" }
            },
            description:
              "Optional. Existing object IDs to REPOSITION into each quadrant instead of creating new items. " +
              "When provided, the items object is ignored. Use when the user says 'reorganize', 'convert', or 'turn into'."
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
          sourceIds: {
            type: "array",
            items: {
              type: "object",
              properties: {
                columnTitle: { type: "string", description: "Which column to place these objects in (must match a title in columns)" },
                objectIds: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into this column" }
              },
              required: ["columnTitle", "objectIds"]
            },
            description:
              "Optional. Existing object IDs to REPOSITION into columns instead of creating new items. " +
              "When provided, the items arrays in columns are ignored. Use when the user says 'reorganize', 'convert', or 'turn into'."
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
        "Create one or more objects on the board. Use this to add sticky notes, rectangles, circles, text labels, or frames. Returns the created object IDs plus each object's final x/y/width/height. For layout tasks, place objects with specific x/y coordinates to form grids, rows, or structured arrangements. To add items inside an EXISTING frame, you MUST use bulk_create_objects instead — it automatically computes x/y positions relative to the frame. If you use parentFrameId here, the x/y coordinates you supply must fall within the frame's content area (frame.x to frame.x+frame.width, frame.y+60 to frame.y+frame.height); otherwise the object will appear outside the frame visually.",
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
                width: { type: "number", description: "Width in pixels (default: sticky=150, rectangle=200, circle=120, text=200, frame=800)" },
                height: { type: "number", description: "Height in pixels (default: sticky=150, rectangle=150, circle=120, text=50, frame=600)" },
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
            description: "How to arrange the objects. Default is 'vertical' when parentFrameId is set (stacks items in a single column to stay within frame width), 'grid' otherwise.",
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
            description: "ID of the parent frame if objects should be contained within one. When set, layout defaults to 'vertical' to keep items stacked within the frame's width.",
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
        "Find objects on the board by text content, type, color, or parent frame. Returns matching object IDs and properties. " +
        "Use when the user says 'find', 'search for', 'which objects have', 'show me all', or before acting on " +
        "objects you need to locate first. Prefer this over read_board_state when you only need a subset of objects.",
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
          parentFrameId: {
            type: "string",
            description: "Only return objects contained within this frame ID.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 100).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_context",
      description:
        "Read scoped board context instead of the full board when possible. " +
        "Use this for selected objects, viewport objects, frame children, object IDs, or a compact board summary.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["board_summary", "selected", "viewport", "frame", "ids"],
            description: "Which context slice to fetch.",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Object IDs (required for scope='ids').",
          },
          frameId: {
            type: "string",
            description: "Frame ID (required for scope='frame').",
          },
          bbox: {
            type: "object",
            description: "Bounding box in canvas coordinates for scope='viewport'.",
            properties: {
              x1: { type: "number" },
              y1: { type: "number" },
              x2: { type: "number" },
              y2: { type: "number" },
            },
            required: ["x1", "y1", "x2", "y2"],
          },
          types: {
            type: "array",
            items: {
              type: "string",
              enum: ["sticky", "rectangle", "circle", "line", "frame", "text"],
            },
            description: "Optional type filter for object scopes.",
          },
          limit: {
            type: "number",
            description: "Max objects to return for viewport/frame scopes (default: 120, max: 500).",
          },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createWireframe",
      description:
        "Create a wireframe/mockup for a UI screen. Generates a frame with rectangular sections representing UI components. " +
        "Use for 'wireframe', 'mockup', 'UI layout', 'page design', 'app screen'. The layout engine handles all positioning automatically.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Screen/page name (e.g. 'Homepage', 'Login Page')" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Section name (e.g. 'Header', 'Hero Banner', 'Sidebar')" },
                heightRatio: { type: "number", description: "Relative height (1 = standard row ~60px). Header=0.5, Hero=2, Content=3, Footer=0.5. Default: 1" },
                split: {
                  type: "string",
                  enum: ["full", "left-sidebar", "right-sidebar", "two-column", "three-column"],
                  description: "How this row is split horizontally. Default: 'full'",
                },
                splitLabels: {
                  type: "array",
                  items: { type: "string" },
                  description: "Labels for each column in the split (e.g. ['Sidebar', 'Main Content'])",
                },
              },
              required: ["label"],
            },
            description: "Ordered list of UI sections from top to bottom",
          },
          width: { type: "number", description: "Frame width in px (default: 375 mobile, 768 tablet, 800 desktop)" },
          deviceType: { type: "string", enum: ["mobile", "tablet", "desktop"], description: "Device form factor. Default: desktop" },
          startX: { type: "number" },
          startY: { type: "number" },
        },
        required: ["title", "sections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createMindMap",
      description:
        "Create a mind map with a central topic and radiating branches. Handles radial positioning and connectors automatically. " +
        "Use for 'mind map', 'brainstorm', 'idea map', 'concept map', 'topic web'.",
      parameters: {
        type: "object",
        properties: {
          centerTopic: { type: "string", description: "The central topic text" },
          branches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Branch topic text" },
                children: {
                  type: "array",
                  items: { type: "string" },
                  description: "Sub-topic texts hanging off this branch",
                },
                color: { type: "string", description: "Color for this branch's stickies (hex or name)" },
              },
              required: ["label"],
            },
            description: "Main branches radiating from the center",
          },
          sourceIds: {
            type: "array",
            items: {
              type: "object",
              properties: {
                branchLabel: { type: "string", description: "Which branch to place these objects under (must match a label in branches)" },
                objectIds: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into this branch" },
              },
              required: ["branchLabel", "objectIds"],
            },
            description:
              "Optional. Existing object IDs to REPOSITION into specific mind map branches instead of creating new nodes. " +
              "Each entry maps objectIds to a branchLabel defined in the branches array. " +
              "Objects keep their text, color, and size — only their positions are updated. " +
              "Use when the user says 'organize', 'reorganize', 'categorize', 'group', 'sort', 'separate', 'convert', or 'turn into'. " +
              "When provided, the children arrays in branches are ignored — existing objects are used instead.",
          },
          startX: { type: "number" },
          startY: { type: "number" },
        },
        required: ["centerTopic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createFlowchart",
      description:
        "Create a flowchart with sequential and branching steps. Handles layout and connectors automatically. " +
        "Use for 'flowchart', 'flow chart', 'process flow', 'workflow', 'decision tree', 'user flow'.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Flowchart title" },
          direction: { type: "string", enum: ["top-to-bottom", "left-to-right"], description: "Layout direction. Default: top-to-bottom" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Step text" },
                type: {
                  type: "string",
                  enum: ["process", "decision", "start", "end"],
                  description: "Step shape: process=rectangle, decision=circle, start/end=small rectangle. Default: process",
                },
                branches: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Branch label (e.g. 'Yes', 'No')" },
                      targetStepIndex: { type: "number", description: "0-based index of the step this branch connects to" },
                    },
                    required: ["label", "targetStepIndex"],
                  },
                  description: "For decision steps: branches to other steps. If omitted, the step connects to the next sequential step.",
                },
              },
              required: ["label"],
            },
            description: "Ordered list of steps in the flow",
          },
          sourceIds: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stepLabel: { type: "string", description: "Label for this step in the flowchart" },
                objectIds: { type: "array", items: { type: "string" }, description: "IDs of existing objects to place at this step (first ID becomes the step node)" },
              },
              required: ["stepLabel", "objectIds"],
            },
            description:
              "Optional. Existing object IDs to REPOSITION into the flowchart instead of creating new step nodes. " +
              "Each entry maps objectIds to a labeled step. Objects are placed in sequential order. " +
              "When provided, the steps array is ignored.",
          },
          startX: { type: "number" },
          startY: { type: "number" },
        },
        required: ["title"],
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
  const cleanedInput = input.replace(/\s*\(.*?\)\s*$/, '');
  const lower = cleanedInput.trim().toLowerCase();
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
  frame:     { width: 800, height: 600, color: "#F9F9F7" },
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
  viewportCenter?: { x: number; y: number };
}

function computeNavigationViewport(
  objects: Array<{ x: number; y: number; width: number; height: number }>,
  screenSize?: { width: number; height: number }
): { x: number; y: number; scale: number } | null {
  if (objects.length === 0) return null;

  const minX = Math.min(...objects.map((o) => o.x));
  const minY = Math.min(...objects.map((o) => o.y));
  const maxX = Math.max(...objects.map((o) => o.x + o.width));
  const maxY = Math.max(...objects.map((o) => o.y + o.height));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const boxW = Math.max(maxX - minX, 1);
  const boxH = Math.max(maxY - minY, 1);

  const sw = screenSize?.width ?? 1280;
  const sh = screenSize?.height ?? 800;
  const pad = 0.82;
  const scale = Math.min(Math.max(Math.min((sw * pad) / boxW, (sh * pad) / boxH), 0.1), 2.0);

  return {
    x: Math.round(sw / 2 - centerX * scale),
    y: Math.round(sh / 2 - centerY * scale),
    scale: Math.round(scale * 1000) / 1000,
  };
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
        .select("id, type, x, y, width, height");

      if (error) {
        return { error: error.message };
      }

      const createdObjects: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }> = [];
      for (const row of data || []) {
        createdIds.push(row.id);
        createdObjects.push({ id: row.id, type: row.type, x: row.x, y: row.y, width: row.width, height: row.height });
      }

      const _viewport = computeNavigationViewport(createdObjects, context.screenSize);
      return {
        created: createdIds.length,
        ids: createdIds,
        objects: createdObjects,
        message: `Created ${createdIds.length} object(s)`,
        ...(_viewport ? { _viewport } : {}),
      };
    }

    // ── Bulk Create Objects ─────────────────────────────
    case "bulk_create_objects": {
      const objType: string = args.type || "sticky";
      const count: number = Math.min(Math.max(args.count || 0, 1), 500);
      // Declare parentFrameId before layout so the conditional default below
      // does not reference it inside the Temporal Dead Zone.
      const parentFrameId: string | null = args.parentFrameId || null;
      // When placing inside a frame, default to vertical stacking so stickies
      // don't overflow the column width and trigger unwanted horizontal expansion.
      const layout: string = args.layout || (parentFrameId ? "vertical" : "grid");
      const gap: number = args.gap ?? 20;
      let startX: number = args.startX ?? context.viewportCenter?.x ?? 100;
      let startY: number = args.startY ?? context.viewportCenter?.y ?? 100;
      const contentPrompt: string | undefined = args.contentPrompt;
      const textPattern: string | undefined = args.textPattern;

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

      // Update DB
      const { data, error } = await supabase
        .from("objects")
        .insert(rows)
        .select("id");

      if (error) {
        return { error: error.message };
      }

      // Automatically fit frames if a parent frame was provided
      if (parentFrameId) {
        // Run the generic fit_frames_to_contents tool with no IDs passed,
        // so it recursively finds all frames and fits them inside out.
        // This ensures both the inner column and the master outer frame resize.
        await executeTool("fit_frames_to_contents", { padding: 30 }, boardId, userId, context, openaiApiKey);
      }

      const createdIds = (data || []).map((r: any) => r.id);
      return {
        created: createdIds.length,
        ids: createdIds,
        message: `Bulk-created ${createdIds.length} ${objType} object(s)${parentFrameId ? ' and resized frames' : ''}`,
      };
    }

    // ── Create Quadrant Layout ────────────────────────────
    case "createQuadrant": {
      const { title, xAxisLabel, yAxisLabel, quadrantLabels, items, quadrantSourceIds } = args;
      const startX = args.startX ?? context.viewportCenter?.x ?? 100;
      const startY = args.startY ?? context.viewportCenter?.y ?? 100;
      const now = new Date().toISOString();
      let zIndex = Date.now();

      const stickyWidth = 150;
      const stickyHeight = 150;
      const gap = 20;
      const quadrantPadding = 30;

      const getGridSize = (count: number) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
        const rows = Math.max(1, Math.ceil(count / cols));
        return { cols, rows };
      };

      // ── Reposition mode: move existing objects into quadrant layout ──
      if (quadrantSourceIds && typeof quadrantSourceIds === "object") {
        const qSrcTL: string[] = quadrantSourceIds.topLeft || [];
        const qSrcTR: string[] = quadrantSourceIds.topRight || [];
        const qSrcBL: string[] = quadrantSourceIds.bottomLeft || [];
        const qSrcBR: string[] = quadrantSourceIds.bottomRight || [];
        const allIds = [...qSrcTL, ...qSrcTR, ...qSrcBL, ...qSrcBR];

        if (allIds.length > 0) {
          const { data: srcObjs } = await supabase
            .from("objects")
            .select("id, width, height")
            .eq("board_id", boardId)
            .in("id", allIds);

          if (!srcObjs || srcObjs.length === 0) {
            return { error: "None of the quadrantSourceIds objects were found on this board." };
          }

          const qCountTL = qSrcTL.length, qCountTR = qSrcTR.length;
          const qCountBL = qSrcBL.length, qCountBR = qSrcBR.length;
          const tlGrid = getGridSize(qCountTL);
          const trGrid = getGridSize(qCountTR);
          const blGrid = getGridSize(qCountBL);
          const brGrid = getGridSize(qCountBR);

          const maxTopRows = Math.max(tlGrid.rows, trGrid.rows, 2);
          const maxBottomRows = Math.max(blGrid.rows, brGrid.rows, 2);
          const maxLeftCols = Math.max(tlGrid.cols, blGrid.cols, 2);
          const maxRightCols = Math.max(trGrid.cols, brGrid.cols, 2);

          const minQW = 2 * stickyWidth + gap + quadrantPadding * 2;
          const minQH = 2 * stickyHeight + gap + quadrantPadding * 2 + 60;
          const qWidthLeft = Math.max(maxLeftCols * stickyWidth + (maxLeftCols - 1) * gap + quadrantPadding * 2, minQW);
          const qWidthRight = Math.max(maxRightCols * stickyWidth + (maxRightCols - 1) * gap + quadrantPadding * 2, minQW);
          const qHeightTop = Math.max(maxTopRows * stickyHeight + (maxTopRows - 1) * gap + quadrantPadding * 2 + 60, minQH);
          const qHeightBottom = Math.max(maxBottomRows * stickyHeight + (maxBottomRows - 1) * gap + quadrantPadding * 2 + 60, minQH);

          const totalWidth = qWidthLeft + qWidthRight + gap;
          const totalHeight = qHeightTop + qHeightBottom + gap;
          const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, totalHeight + 80, startX, startY);

          let totalCreated = 0;
          const quadrantIds: Record<string, string> = {};

          const { data: masterData, error: masterErr } = await supabase
            .from("objects")
            .insert({
              board_id: boardId, type: "frame",
              x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80,
              color: "#F9F9F7", text: title || "Quadrant Layout", rotation: 0,
              z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
            })
            .select("id")
            .single();
          if (masterErr || !masterData) return { error: masterErr?.message || "Failed to create master frame" };
          const masterFrameId = masterData.id;
          totalCreated++;

          const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];

          const buildQuadrantRepos = async (
            qTitle: string, srcIds: string[], qX: number, qY: number, qWidth: number, qHeight: number, qCols: number, key: string
          ) => {
            const { data: qData, error: qErr } = await supabase
              .from("objects")
              .insert({
                board_id: boardId, type: "frame",
                x: qX, y: qY, width: qWidth, height: qHeight,
                color: "#F9F9F7", text: qTitle || key,
                parent_frame_id: masterFrameId, rotation: 0,
                z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
              })
              .select("id")
              .single();
            if (qErr || !qData) throw new Error(qErr?.message || "Failed to create quadrant frame");
            quadrantIds[key] = qData.id;
            totalCreated++;

            for (let i = 0; i < srcIds.length; i++) {
              const col = i % qCols;
              const row = Math.floor(i / qCols);
              patches.push({
                id: srcIds[i],
                x: qX + quadrantPadding + col * (stickyWidth + gap),
                y: qY + 60 + row * (stickyHeight + gap),
                parentFrameId: qData.id,
              });
            }
          };

          try {
            const startInnerX = pos.x + 20;
            const startInnerY = pos.y + 60;
            await buildQuadrantRepos(quadrantLabels?.topLeft, qSrcTL, startInnerX, startInnerY, qWidthLeft, qHeightTop, tlGrid.cols, "topLeft");
            await buildQuadrantRepos(quadrantLabels?.topRight, qSrcTR, startInnerX + qWidthLeft + gap, startInnerY, qWidthRight, qHeightTop, trGrid.cols, "topRight");
            await buildQuadrantRepos(quadrantLabels?.bottomLeft, qSrcBL, startInnerX, startInnerY + qHeightTop + gap, qWidthLeft, qHeightBottom, blGrid.cols, "bottomLeft");
            await buildQuadrantRepos(quadrantLabels?.bottomRight, qSrcBR, startInnerX + qWidthLeft + gap, startInnerY + qHeightTop + gap, qWidthRight, qHeightBottom, brGrid.cols, "bottomRight");
          } catch (err: any) {
            return { error: err.message };
          }

          const moved = await repositionObjects(supabase, boardId, patches);
          const _qViewport = computeNavigationViewport(
            [{ x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80 }],
            context.screenSize
          );
          return {
            created: totalCreated,
            repositioned: moved,
            frameId: masterFrameId,
            quadrantIds,
            message: `Reorganized ${moved} objects into quadrant layout with ${totalCreated} new frames.`,
            ...(_qViewport ? { _viewport: _qViewport } : {}),
          };
        }
      }

      // ── Normal create mode ──
      const tlItems: string[] = items?.topLeft || [];
      const trItems: string[] = items?.topRight || [];
      const blItems: string[] = items?.bottomLeft || [];
      const brItems: string[] = items?.bottomRight || [];

      const tlGrid = getGridSize(tlItems.length);
      const trGrid = getGridSize(trItems.length);
      const blGrid = getGridSize(blItems.length);
      const brGrid = getGridSize(brItems.length);

      const maxTopRows = Math.max(tlGrid.rows, trGrid.rows);
      const maxBottomRows = Math.max(blGrid.rows, brGrid.rows);
      const maxLeftCols = Math.max(tlGrid.cols, blGrid.cols);
      const maxRightCols = Math.max(trGrid.cols, brGrid.cols);

      const minQuadrantWidth = 2 * stickyWidth + gap + quadrantPadding * 2;
      const minQuadrantHeight = 2 * stickyHeight + gap + quadrantPadding * 2 + 60;
      const qWidthLeft = Math.max(maxLeftCols * stickyWidth + (maxLeftCols - 1) * gap + quadrantPadding * 2, minQuadrantWidth);
      const qWidthRight = Math.max(maxRightCols * stickyWidth + (maxRightCols - 1) * gap + quadrantPadding * 2, minQuadrantWidth);
      const qHeightTop = Math.max(maxTopRows * stickyHeight + (maxTopRows - 1) * gap + quadrantPadding * 2 + 60, minQuadrantHeight);
      const qHeightBottom = Math.max(maxBottomRows * stickyHeight + (maxBottomRows - 1) * gap + quadrantPadding * 2 + 60, minQuadrantHeight);

      const totalWidth = qWidthLeft + qWidthRight + gap;
      const totalHeight = qHeightTop + qHeightBottom + gap;

      const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, totalHeight + 80, startX, startY);

      let parentFrameId: string | null = null;
      let totalCreated = 0;
      const quadrantIds: Record<string, string> = {};

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
              y: qY + 60 + row * (stickyHeight + gap),
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

      const _qViewport = computeNavigationViewport(
        [{ x: pos.x, y: pos.y, width: totalWidth + 40, height: totalHeight + 80 }],
        context.screenSize
      );
      return {
        created: totalCreated,
        frameId: parentFrameId,
        quadrantIds,
        message: `Created quadrant layout with ${totalCreated} objects.`,
        ...(_qViewport ? { _viewport: _qViewport } : {}),
      };
    }

    // ── Create Column Layout ────────────────────────────
    case "createColumnLayout": {
      const { title, columns, sourceIds: colSourceIds } = args;
      if (!Array.isArray(columns) || columns.length === 0) {
        return { error: "columns array is required and cannot be empty" };
      }

      const startX = args.startX ?? context.viewportCenter?.x ?? 100;
      const startY = args.startY ?? context.viewportCenter?.y ?? 100;
      const now = new Date().toISOString();
      let zIndex = Date.now();

      const stickyWidth = 150;
      const stickyHeight = 150;
      const gap = 20;
      const colPadding = 30;

      // ── Reposition mode: move existing objects into column layout ──
      if (Array.isArray(colSourceIds) && colSourceIds.length > 0) {
        const allObjIds = colSourceIds.flatMap((s: any) => s.objectIds || []);
        const { data: srcObjs } = await supabase
          .from("objects")
          .select("id, width, height")
          .eq("board_id", boardId)
          .in("id", allObjIds);

        if (!srcObjs || srcObjs.length === 0) {
          return { error: "None of the sourceIds objects were found on this board." };
        }
        const objMap = new Map(srcObjs.map((o: any) => [o.id, o]));

        const maxPerCol = Math.max(...colSourceIds.map((s: any) => (s.objectIds || []).length), 0);
        const colWidth = stickyWidth + colPadding * 2;
        const totalWidth = columns.length * (colWidth + gap) - gap;
        const minStickySlots = 4;
        const itemCount = Math.max(maxPerCol, minStickySlots);
        const colHeight = itemCount * stickyHeight + (itemCount - 1) * gap + colPadding * 2 + 60;

        const pos = await findOpenCanvasSpace(boardId, totalWidth + 40, colHeight + 80, startX, startY);
        const colors = ["#E5E5E0", "#7FC8E8", "#FAD84E", "#9DD9A3", "#F5A8C4"];

        let masterFrameId: string | null = null;
        let totalCreated = 0;
        const columnIds: Record<string, string> = {};

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
          masterFrameId = masterData.id;
          totalCreated++;
        }

        const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
        const colSourceMap = new Map(colSourceIds.map((s: any) => [s.columnTitle, s.objectIds || []]));

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
              parent_frame_id: masterFrameId,
              rotation: 0, z_index: zIndex++,
              created_by: userId, created_at: now, updated_at: now,
            })
            .select("id")
            .single();
          if (colErr || !colData) continue;
          const colFrameId = colData.id;
          columnIds[col.title || `Column ${colIdx + 1}`] = colFrameId;
          totalCreated++;

          const idsForCol: string[] = colSourceMap.get(col.title) || [];
          for (let i = 0; i < idsForCol.length; i++) {
            const objId = idsForCol[i];
            if (!objMap.has(objId)) continue;
            patches.push({
              id: objId,
              x: cx + colPadding,
              y: cy + 60 + i * (stickyHeight + gap),
              parentFrameId: colFrameId,
            });
          }
        }

        const moved = await repositionObjects(supabase, boardId, patches);
        const colLayoutBounds = [{ x: pos.x, y: pos.y, width: totalWidth + 40, height: colHeight + 80 }];
        const _clViewport = computeNavigationViewport(colLayoutBounds, context.screenSize);

        return {
          created: totalCreated,
          repositioned: moved,
          frameId: masterFrameId ?? undefined,
          columnIds,
          message: `Reorganized ${moved} objects into column layout with ${totalCreated} new frames.`,
          ...(_clViewport ? { _viewport: _clViewport } : {}),
        };
      }

      // ── Normal create mode ──
      const maxItems = Math.max(...columns.map((c: any) => Array.isArray(c.items) ? c.items.length : 0));
      const colWidth = stickyWidth + colPadding * 2;
      const totalWidth = columns.length * (colWidth + gap) - gap;
      const minStickySlots = 4;
      const minColHeight = minStickySlots * stickyHeight + (minStickySlots - 1) * gap + colPadding * 2 + 60;
      const colHeight = Math.max(maxItems * stickyHeight + (maxItems > 0 ? (maxItems - 1) * gap : 0) + colPadding * 2 + 60, minColHeight);

      const pos = await findOpenCanvasSpace(boardId, totalWidth, colHeight, startX, startY);

      const colors = ["#E5E5E0", "#7FC8E8", "#FAD84E", "#9DD9A3", "#F5A8C4"];
      let parentFrameId: string | null = null;
      let totalCreated = 0;
      const columnIds: Record<string, string> = {};

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

      const colLayoutBounds = parentFrameId
        ? [{ x: pos.x, y: pos.y, width: totalWidth + 40, height: colHeight + 80 }]
        : [{ x: pos.x, y: pos.y, width: totalWidth, height: colHeight }];
      const _clViewport = computeNavigationViewport(colLayoutBounds, context.screenSize);
      return {
        created: totalCreated,
        frameId: parentFrameId ?? undefined,
        columnIds,
        message: `Created column layout with ${totalCreated} objects.`,
        ...(_clViewport ? { _viewport: _clViewport } : {}),
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
      const searchParent: string | undefined = args.parentFrameId;
      const searchLimit: number = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 500) : 100;

      if (!searchText && !searchType && !searchColor && !searchParent) {
        return { error: "Provide at least one of: text, type, color, parentFrameId." };
      }

      let query = supabase
        .from("objects")
        .select("id, type, x, y, width, height, color, text, parent_frame_id")
        .eq("board_id", boardId);

      if (searchType)   query = query.eq("type", searchType);
      if (searchText)   query = query.ilike("text", `%${searchText}%`);
      if (searchParent) query = query.eq("parent_frame_id", searchParent);
      if (searchColor) {
        const hex = resolveColor(searchColor) ?? searchColor;
        query = query.ilike("color", hex);
      }

      query = query.limit(searchLimit);

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

    // ── Scoped board context ───────────────────────────────
    case "get_board_context": {
      const scope: string = args.scope || "board_summary";
      const limit: number =
        typeof args.limit === "number" && Number.isFinite(args.limit)
          ? Math.min(Math.max(1, Math.floor(args.limit)), 500)
          : 120;
      const types: string[] | undefined = Array.isArray(args.types)
        ? args.types.filter((t: unknown) => typeof t === "string")
        : undefined;

      if (scope === "board_summary") {
        const summary = await fetchBoardSummary(boardId);
        return { scope, ...summary };
      }

      if (scope === "selected") {
        const ids = Array.isArray(context.selectedIds) ? context.selectedIds : [];
        if (ids.length === 0) {
          return { scope, found: 0, objects: [], message: "No selected objects." };
        }
        const objects = await fetchObjectsByIds(boardId, ids, types);
        return {
          scope,
          requested: ids.length,
          found: objects.length,
          objects,
          message: `Loaded ${objects.length} selected object(s).`,
        };
      }

      if (scope === "ids") {
        const ids: string[] = Array.isArray(args.ids)
          ? args.ids.filter((id: unknown) => typeof id === "string")
          : [];
        if (ids.length === 0) {
          return { error: "scope='ids' requires a non-empty ids array." };
        }
        const objects = await fetchObjectsByIds(boardId, ids, types);
        return {
          scope,
          requested: ids.length,
          found: objects.length,
          objects,
          message: `Loaded ${objects.length} object(s) by ID.`,
        };
      }

      if (scope === "viewport") {
        const bbox = args.bbox;
        if (!bbox || typeof bbox !== "object") {
          return { error: "scope='viewport' requires bbox with x1,y1,x2,y2." };
        }

        const x1 = Number((bbox as any).x1);
        const y1 = Number((bbox as any).y1);
        const x2 = Number((bbox as any).x2);
        const y2 = Number((bbox as any).y2);

        if (![x1, y1, x2, y2].every(Number.isFinite)) {
          return { error: "bbox values must be finite numbers." };
        }

        const objects = await fetchObjectsInBbox(boardId, { x1, y1, x2, y2 }, {
          types,
          limit,
        });

        return {
          scope,
          bbox: {
            x1: Math.min(x1, x2),
            y1: Math.min(y1, y2),
            x2: Math.max(x1, x2),
            y2: Math.max(y1, y2),
          },
          found: objects.length,
          objects,
          message: `Loaded ${objects.length} viewport object(s).`,
        };
      }

      if (scope === "frame") {
        const frameId: string | undefined = typeof args.frameId === "string" ? args.frameId : undefined;
        if (!frameId) {
          return { error: "scope='frame' requires frameId." };
        }

        const frameContext = await fetchFrameWithChildren(boardId, frameId, {
          types,
          limit,
        });

        if (!frameContext) {
          return { error: `Frame not found: ${frameId}` };
        }

        return {
          scope,
          frame: frameContext.frame,
          childCount: frameContext.children.length,
          children: frameContext.children,
          message: `Loaded frame and ${frameContext.children.length} child object(s).`,
        };
      }

      return {
        error:
          "Invalid scope. Supported scopes: board_summary, selected, viewport, frame, ids.",
      };
    }

    // ── Create Wireframe ───────────────────────────────────
    case "createWireframe": {
      const { title, sections, deviceType = "desktop" } = args;
      if (!Array.isArray(sections) || sections.length === 0) {
        return { error: "sections array is required and cannot be empty" };
      }

      const frameWidth = args.width ?? (deviceType === "mobile" ? 375 : deviceType === "tablet" ? 768 : 800);
      const rowUnit = 60;
      const sectionGap = 4;
      const sectionPad = 8;

      let totalHeight = sectionPad;
      for (const section of sections) {
        totalHeight += (section.heightRatio ?? 1) * rowUnit + sectionGap;
      }
      totalHeight += sectionPad;

      const defaultX = context.viewportCenter?.x ? context.viewportCenter.x - Math.round(frameWidth / 2) : 100;
      const defaultY = context.viewportCenter?.y ? context.viewportCenter.y - Math.round(totalHeight / 2) : 100;
      const pos = await findOpenCanvasSpace(boardId, frameWidth + 40, totalHeight + 80, args.startX ?? defaultX, args.startY ?? defaultY);

      const now = new Date().toISOString();
      let zIndex = Date.now();

      const { data: frameData, error: frameErr } = await supabase
        .from("objects")
        .insert({
          board_id: boardId, type: "frame",
          x: pos.x, y: pos.y, width: frameWidth + 40, height: totalHeight + 80,
          color: "#F9F9F7", text: title || "Wireframe", rotation: 0,
          z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
        })
        .select("id")
        .single();

      if (frameErr || !frameData) return { error: frameErr?.message || "Failed to create wireframe frame" };
      const frameId = frameData.id;

      const children: any[] = [];
      let curY = pos.y + 60;

      for (const section of sections) {
        const ratio = section.heightRatio ?? 1;
        const sectionHeight = ratio * rowUnit;
        const split: string = section.split ?? "full";

        if (split === "full") {
          children.push({
            board_id: boardId, type: "rectangle",
            x: pos.x + sectionPad + 20, y: curY,
            width: frameWidth - sectionPad * 2, height: sectionHeight,
            color: "#E5E5E0", text: section.label || "",
            parent_frame_id: frameId, rotation: 0,
            z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
          });
        } else {
          const splits = split === "two-column" ? [0.5, 0.5]
            : split === "three-column" ? [0.333, 0.334, 0.333]
            : split === "left-sidebar" ? [0.25, 0.75]
            : [0.75, 0.25]; // right-sidebar

          const labels: string[] = section.splitLabels ?? [];
          let curX = pos.x + sectionPad + 20;
          const availW = frameWidth - sectionPad * 2;

          splits.forEach((frac: number, i: number) => {
            const w = Math.round(availW * frac - (i < splits.length - 1 ? sectionGap : 0));
            children.push({
              board_id: boardId, type: "rectangle",
              x: Math.round(curX), y: curY,
              width: w, height: sectionHeight,
              color: "#E5E5E0", text: labels[i] ?? section.label ?? "",
              parent_frame_id: frameId, rotation: 0,
              z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
            });
            curX += w + sectionGap;
          });
        }
        curY += sectionHeight + sectionGap;
      }

      if (children.length > 0) {
        const { error: childErr } = await supabase.from("objects").insert(children);
        if (childErr) return { error: childErr.message };
      }

      const allCreated = [
        { x: pos.x, y: pos.y, width: frameWidth + 40, height: totalHeight + 80 },
        ...children.map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height })),
      ];
      const _viewport = computeNavigationViewport(allCreated, context.screenSize);

      return {
        created: 1 + children.length,
        frameId,
        message: `Created wireframe "${title}" with ${children.length} sections.`,
        ...(_viewport ? { _viewport } : {}),
      };
    }

    // ── Create Mind Map ──────────────────────────────────────
    case "createMindMap": {
      const { centerTopic, branches, sourceIds: mmSourceIds } = args;

      const innerRadius = 250;
      const outerRadius = 450;
      const branchColors = ["#7FC8E8", "#9DD9A3", "#FAD84E", "#F5A8C4", "#E5E5E0"];

      const defaultCX = context.viewportCenter?.x ?? 500;
      const defaultCY = context.viewportCenter?.y ?? 400;
      const cx = args.startX ?? defaultCX;
      const cy = args.startY ?? defaultCY;

      // ── Reposition mode: move existing objects into specific branches ──
      if (Array.isArray(mmSourceIds) && mmSourceIds.length > 0 && Array.isArray(branches) && branches.length > 0) {
        const allObjIds = mmSourceIds.flatMap((s: any) => s.objectIds || []);
        const { data: srcObjs } = await supabase
          .from("objects")
          .select("id, x, y, width, height")
          .eq("board_id", boardId)
          .in("id", allObjIds);

        if (!srcObjs || srcObjs.length === 0) {
          return { error: "None of the sourceIds objects were found on this board." };
        }
        const objMap = new Map(srcObjs.map((o: any) => [o.id, o]));
        const sourceMap = new Map(mmSourceIds.map((s: any) => [s.branchLabel, s.objectIds || []]));

        const now = new Date().toISOString();
        let zIndex = Date.now();
        const centerW = 200;
        const centerH = 80;
        const branchW = 160;
        const branchH = 60;

        const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
        const allPositions: Array<{ x: number; y: number; width: number; height: number }> = [];
        const connectorRows: any[] = [];
        let totalCreated = 0;

        const { data: centerData, error: centerErr } = await supabase
          .from("objects")
          .insert({
            board_id: boardId, type: "rectangle",
            x: cx - centerW / 2, y: cy - centerH / 2,
            width: centerW, height: centerH,
            color: "#3B82F6", text: centerTopic || "Central Topic",
            rotation: 0, z_index: zIndex++,
            created_by: userId, created_at: now, updated_at: now,
          })
          .select("id")
          .single();

        if (centerErr || !centerData) return { error: centerErr?.message || "Failed to create center node" };
        const centerId = centerData.id;
        totalCreated++;
        allPositions.push({ x: cx - centerW / 2, y: cy - centerH / 2, width: centerW, height: centerH });

        const n = branches.length;
        for (let i = 0; i < n; i++) {
          const branch = branches[i];
          const angle = (2 * Math.PI * i) / n - Math.PI / 2;
          const bx = cx + Math.round(innerRadius * Math.cos(angle)) - branchW / 2;
          const by = cy + Math.round(innerRadius * Math.sin(angle)) - branchH / 2;
          const color = (branch.color ? resolveColor(branch.color) : null) || branchColors[i % branchColors.length];

          const { data: bData, error: bErr } = await supabase
            .from("objects")
            .insert({
              board_id: boardId, type: "sticky",
              x: bx, y: by, width: branchW, height: branchH,
              color, text: branch.label || "",
              rotation: 0, z_index: zIndex++,
              created_by: userId, created_at: now, updated_at: now,
            })
            .select("id")
            .single();

          if (bErr || !bData) continue;
          totalCreated++;
          allPositions.push({ x: bx, y: by, width: branchW, height: branchH });

          connectorRows.push({
            board_id: boardId,
            from_id: centerId, to_id: bData.id,
            style: "arrow", color: null, stroke_width: null,
            from_point: null, to_point: null,
          });

          const idsForBranch: string[] = sourceMap.get(branch.label) || [];
          if (idsForBranch.length > 0) {
            const subAngleSpread = (2 * Math.PI / Math.max(n, 2)) * 0.6;
            let currentLayerRadius = outerRadius;
            let remainingIds = [...idsForBranch];
            const layers: string[][] = [];

            while (remainingIds.length > 0) {
              const availableArcLength = currentLayerRadius * subAngleSpread;
              const maxItems = Math.max(1, Math.floor(availableArcLength / 180) + 1);
              layers.push(remainingIds.slice(0, maxItems));
              remainingIds = remainingIds.slice(maxItems);
              currentLayerRadius += 220;
            }

            for (let l = 0; l < layers.length; l++) {
              const layerIds = layers[l];
              const layerRadius = outerRadius + l * 220;
              const spread = Math.min(subAngleSpread, (layerIds.length * 180) / layerRadius);

              for (let k = 0; k < layerIds.length; k++) {
                const objId = layerIds[k];
                const obj = objMap.get(objId);
                if (!obj) continue;

                const subAngleOffset = layerIds.length > 1 
                  ? (k - (layerIds.length - 1) / 2) * (spread / (layerIds.length - 1))
                  : 0;
                const subAngle = angle + subAngleOffset;
                const sx = cx + Math.round(layerRadius * Math.cos(subAngle)) - Math.round((obj.width || 150) / 2);
                const sy = cy + Math.round(layerRadius * Math.sin(subAngle)) - Math.round((obj.height || 150) / 2);

                patches.push({ id: objId, x: sx, y: sy, parentFrameId: null });
                allPositions.push({ x: sx, y: sy, width: obj.width || 150, height: obj.height || 150 });

                connectorRows.push({
                  board_id: boardId,
                  from_id: bData.id, to_id: objId,
                  style: "arrow", color: null, stroke_width: null,
                  from_point: null, to_point: null,
                });
              }
            }
          }
        }

        const moved = await repositionObjects(supabase, boardId, patches);

        if (connectorRows.length > 0) {
          await supabase.from("connectors").insert(connectorRows);
        }

        const _viewport = computeNavigationViewport(allPositions, context.screenSize);

        return {
          created: totalCreated,
          repositioned: moved,
          connectors: connectorRows.length,
          centerId,
          message: `Created mind map with ${totalCreated} new nodes. Repositioned ${moved} existing objects into branches with ${connectorRows.length} connectors.`,
          ...(_viewport ? { _viewport } : {}),
        };
      }

      // ── Normal create mode ──
      if (!Array.isArray(branches) || branches.length === 0) {
        return { error: "branches array is required and cannot be empty" };
      }

      const now = new Date().toISOString();
      let zIndex = Date.now();
      const centerW = 200;
      const centerH = 80;
      const branchW = 160;
      const branchH = 60;
      const subW = 140;
      const subH = 50;

      const { data: centerData, error: centerErr } = await supabase
        .from("objects")
        .insert({
          board_id: boardId, type: "rectangle",
          x: cx - centerW / 2, y: cy - centerH / 2,
          width: centerW, height: centerH,
          color: "#3B82F6", text: centerTopic || "Central Topic",
          rotation: 0, z_index: zIndex++,
          created_by: userId, created_at: now, updated_at: now,
        })
        .select("id")
        .single();

      if (centerErr || !centerData) return { error: centerErr?.message || "Failed to create center node" };
      const centerId = centerData.id;
      let totalCreated = 1;
      const connectorRows: any[] = [];
      const allPositions: Array<{ x: number; y: number; width: number; height: number }> = [
        { x: cx - centerW / 2, y: cy - centerH / 2, width: centerW, height: centerH },
      ];

      const n = branches.length;
      for (let i = 0; i < n; i++) {
        const branch = branches[i];
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const bx = cx + Math.round(innerRadius * Math.cos(angle)) - branchW / 2;
        const by = cy + Math.round(innerRadius * Math.sin(angle)) - branchH / 2;
        const color = (branch.color ? resolveColor(branch.color) : null) || branchColors[i % branchColors.length];

        const { data: bData, error: bErr } = await supabase
          .from("objects")
          .insert({
            board_id: boardId, type: "sticky",
            x: bx, y: by, width: branchW, height: branchH,
            color, text: branch.label || "",
            rotation: 0, z_index: zIndex++,
            created_by: userId, created_at: now, updated_at: now,
          })
          .select("id")
          .single();

        if (bErr || !bData) continue;
        totalCreated++;
        allPositions.push({ x: bx, y: by, width: branchW, height: branchH });

        connectorRows.push({
          board_id: boardId,
          from_id: centerId, to_id: bData.id,
          style: "arrow", color: null, stroke_width: null,
          from_point: null, to_point: null,
        });

        const children: string[] = Array.isArray(branch.children) ? branch.children : [];
        if (children.length > 0) {
          const subAngleSpread = (2 * Math.PI / Math.max(n, 2)) * 0.6;
          let currentLayerRadius = outerRadius;
          let remainingTexts = [...children];
          const layers: string[][] = [];

          while (remainingTexts.length > 0) {
            const availableArcLength = currentLayerRadius * subAngleSpread;
            const maxItems = Math.max(1, Math.floor(availableArcLength / 180) + 1);
            layers.push(remainingTexts.slice(0, maxItems));
            remainingTexts = remainingTexts.slice(maxItems);
            currentLayerRadius += 220;
          }

          for (let l = 0; l < layers.length; l++) {
            const layerTexts = layers[l];
            const layerRadius = outerRadius + l * 220;
            const spread = Math.min(subAngleSpread, (layerTexts.length * 180) / layerRadius);

            for (let k = 0; k < layerTexts.length; k++) {
              const subAngleOffset = layerTexts.length > 1 
                ? (k - (layerTexts.length - 1) / 2) * (spread / (layerTexts.length - 1))
                : 0;
              const subAngle = angle + subAngleOffset;
              const sx = cx + Math.round(layerRadius * Math.cos(subAngle)) - subW / 2;
              const sy = cy + Math.round(layerRadius * Math.sin(subAngle)) - subH / 2;

              const { data: sData, error: sErr } = await supabase
                .from("objects")
                .insert({
                  board_id: boardId, type: "sticky",
                  x: sx, y: sy, width: subW, height: subH,
                  color, text: layerTexts[k] || "",
                  rotation: 0, z_index: zIndex++,
                  created_by: userId, created_at: now, updated_at: now,
                })
                .select("id")
                .single();

              if (sErr || !sData) continue;
              totalCreated++;
              allPositions.push({ x: sx, y: sy, width: subW, height: subH });

              connectorRows.push({
                board_id: boardId,
                from_id: bData.id, to_id: sData.id,
                style: "arrow", color: null, stroke_width: null,
                from_point: null, to_point: null,
              });
            }
          }
        }
      }

      if (connectorRows.length > 0) {
        await supabase.from("connectors").insert(connectorRows);
      }

      const _viewport = computeNavigationViewport(allPositions, context.screenSize);

      return {
        created: totalCreated,
        connectors: connectorRows.length,
        centerId,
        message: `Created mind map with ${totalCreated} nodes and ${connectorRows.length} connectors.`,
        ...(_viewport ? { _viewport } : {}),
      };
    }

    // ── Create Flowchart ─────────────────────────────────────
    case "createFlowchart": {
      const { title, steps, direction = "top-to-bottom", sourceIds: fcSourceIds } = args;
      const isVertical = direction === "top-to-bottom";

      // ── Reposition mode: move existing objects into flowchart steps ──
      if (Array.isArray(fcSourceIds) && fcSourceIds.length > 0) {
        const allObjIds = fcSourceIds.flatMap((s: any) => s.objectIds || []);
        const { data: srcObjs } = await supabase
          .from("objects")
          .select("id, x, y, width, height")
          .eq("board_id", boardId)
          .in("id", allObjIds);

        if (!srcObjs || srcObjs.length === 0) {
          return { error: "None of the sourceIds objects were found on this board." };
        }
        const objMap = new Map(srcObjs.map((o: any) => [o.id, o]));

        const stepGapR = 80;
        const defaultX = context.viewportCenter?.x ?? 200;
        const defaultY = context.viewportCenter?.y ?? 200;
        let cursorX = args.startX ?? defaultX;
        let cursorY = args.startY ?? defaultY;

        const patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }> = [];
        const allPositions: Array<{ x: number; y: number; width: number; height: number }> = [];
        const connectorRows: any[] = [];
        let prevId: string | null = null;

        for (let i = 0; i < fcSourceIds.length; i++) {
          const step = fcSourceIds[i];
          const ids: string[] = step.objectIds || [];
          const firstId = ids[0];
          const obj = firstId ? objMap.get(firstId) : null;
          if (!obj) continue;

          const w = obj.width || 200;
          const h = obj.height || 80;
          patches.push({ id: obj.id, x: cursorX, y: cursorY, parentFrameId: null });
          allPositions.push({ x: cursorX, y: cursorY, width: w, height: h });

          if (prevId) {
            connectorRows.push({
              board_id: boardId,
              from_id: prevId, to_id: obj.id,
              style: "arrow", color: null, stroke_width: null,
              from_point: null, to_point: null,
            });
          }
          prevId = obj.id;

          if (isVertical) cursorY += h + stepGapR;
          else cursorX += w + stepGapR;
        }

        const moved = await repositionObjects(supabase, boardId, patches);
        if (connectorRows.length > 0) {
          await supabase.from("connectors").insert(connectorRows);
        }

        const _viewport = computeNavigationViewport(allPositions, context.screenSize);
        return {
          repositioned: moved,
          connectors: connectorRows.length,
          message: `Reorganized ${moved} objects into a ${direction} flowchart with ${connectorRows.length} connectors.`,
          ...(_viewport ? { _viewport } : {}),
        };
      }

      // ── Normal create mode ──
      if (!Array.isArray(steps) || steps.length === 0) {
        return { error: "steps array is required and cannot be empty" };
      }

      const now = new Date().toISOString();
      let zIndex = Date.now();
      const stepGap = 80;
      const processW = 200;
      const processH = 80;
      const decisionSize = 100;
      const startEndW = 150;
      const startEndH = 50;

      const getStepDims = (type: string) => {
        switch (type) {
          case "decision": return { w: decisionSize, h: decisionSize };
          case "start": case "end": return { w: startEndW, h: startEndH };
          default: return { w: processW, h: processH };
        }
      };

      // Calculate total bounds for frame
      const totalSteps = steps.length;
      const maxW = Math.max(processW, decisionSize, startEndW);
      const maxH = Math.max(processH, decisionSize, startEndH);
      const totalSpan = totalSteps * (isVertical ? maxH : maxW) + (totalSteps - 1) * stepGap;
      const frameW = isVertical ? maxW + 200 : totalSpan + 200;
      const frameH = isVertical ? totalSpan + 160 : maxH + 250;

      const defaultX = context.viewportCenter?.x ? context.viewportCenter.x - Math.round(frameW / 2) : 100;
      const defaultY = context.viewportCenter?.y ? context.viewportCenter.y - Math.round(frameH / 2) : 100;
      const pos = await findOpenCanvasSpace(boardId, frameW, frameH, args.startX ?? defaultX, args.startY ?? defaultY);

      // Create frame
      const { data: frameData, error: frameErr } = await supabase
        .from("objects")
        .insert({
          board_id: boardId, type: "frame",
          x: pos.x, y: pos.y, width: frameW, height: frameH,
          color: "#F9F9F7", text: title || "Flowchart", rotation: 0,
          z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
        })
        .select("id")
        .single();

      if (frameErr || !frameData) return { error: frameErr?.message || "Failed to create flowchart frame" };
      const frameId = frameData.id;

      // Create step nodes
      const stepIds: string[] = [];
      const stepPositions: Array<{ x: number; y: number; width: number; height: number }> = [];
      let totalCreated = 1; // frame

      const contentStartX = pos.x + Math.round(frameW / 2);
      const contentStartY = pos.y + 80;

      for (let i = 0; i < totalSteps; i++) {
        const step = steps[i];
        const stepType: string = step.type || "process";
        const dims = getStepDims(stepType);
        const color = stepType === "decision" ? "#FAD84E"
          : stepType === "start" || stepType === "end" ? "#9DD9A3"
          : "#E5E5E0";
        const shapeType = stepType === "decision" ? "circle" : "rectangle";

        const sx = isVertical
          ? contentStartX - Math.round(dims.w / 2)
          : contentStartX - Math.round(frameW / 2) + 100 + i * (maxW + stepGap);
        const sy = isVertical
          ? contentStartY + i * (maxH + stepGap)
          : contentStartY + Math.round((frameH - 160) / 2) - Math.round(dims.h / 2);

        const { data: sData, error: sErr } = await supabase
          .from("objects")
          .insert({
            board_id: boardId, type: shapeType,
            x: sx, y: sy, width: dims.w, height: dims.h,
            color, text: step.label || `Step ${i + 1}`,
            parent_frame_id: frameId, rotation: 0,
            z_index: zIndex++, created_by: userId, created_at: now, updated_at: now,
          })
          .select("id")
          .single();

        if (sErr || !sData) {
          stepIds.push("");
          stepPositions.push({ x: sx, y: sy, width: dims.w, height: dims.h });
          continue;
        }
        stepIds.push(sData.id);
        stepPositions.push({ x: sx, y: sy, width: dims.w, height: dims.h });
        totalCreated++;
      }

      // Create connectors
      const connectorRows: any[] = [];
      for (let i = 0; i < totalSteps; i++) {
        const step = steps[i];
        const fromId = stepIds[i];
        if (!fromId) continue;

        if (Array.isArray(step.branches) && step.branches.length > 0) {
          for (const branch of step.branches) {
            const targetIdx = branch.targetStepIndex;
            if (typeof targetIdx === "number" && targetIdx >= 0 && targetIdx < totalSteps && stepIds[targetIdx]) {
              connectorRows.push({
                board_id: boardId,
                from_id: fromId, to_id: stepIds[targetIdx],
                style: "arrow", color: null, stroke_width: null,
                from_point: null, to_point: null,
              });
            }
          }
          // Also connect to the next sequential step (the "default" path)
          if (i + 1 < totalSteps && stepIds[i + 1]) {
            connectorRows.push({
              board_id: boardId,
              from_id: fromId, to_id: stepIds[i + 1],
              style: "arrow", color: null, stroke_width: null,
              from_point: null, to_point: null,
            });
          }
        } else if (i + 1 < totalSteps && stepIds[i + 1]) {
          connectorRows.push({
            board_id: boardId,
            from_id: fromId, to_id: stepIds[i + 1],
            style: "arrow", color: null, stroke_width: null,
            from_point: null, to_point: null,
          });
        }
      }

      if (connectorRows.length > 0) {
        await supabase.from("connectors").insert(connectorRows);
      }

      const allBounds = [
        { x: pos.x, y: pos.y, width: frameW, height: frameH },
        ...stepPositions,
      ];
      const _viewport = computeNavigationViewport(allBounds, context.screenSize);

      return {
        created: totalCreated,
        connectors: connectorRows.length,
        frameId,
        stepIds: stepIds.filter(Boolean),
        message: `Created flowchart "${title}" with ${totalCreated} objects and ${connectorRows.length} connectors.`,
        ...(_viewport ? { _viewport } : {}),
      };
    }

    // ── Read Board State ─────────────────────────────────────
    case "read_board_state": {
      return await fetchBoardState(boardId);
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Batch-reposition existing objects. Used by template tools when
 * sourceObjectIds is provided to reorganize instead of create.
 */
async function repositionObjects(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boardId: string,
  patches: Array<{ id: string; x: number; y: number; parentFrameId?: string | null }>
): Promise<number> {
  if (patches.length === 0) return 0;
  const now = new Date().toISOString();

  for (let i = 0; i < patches.length; i += PATCH_BULK_CHUNK_SIZE) {
    const chunk = patches.slice(i, i + PATCH_BULK_CHUNK_SIZE);
    const ids = chunk.map((p) => p.id);

    const { data: existing } = await supabase
      .from("objects")
      .select("*")
      .eq("board_id", boardId)
      .in("id", ids);

    if (!existing?.length) continue;

    const byId = new Map(existing.map((r: any) => [r.id, r]));
    const rows: any[] = [];

    for (const patch of chunk) {
      const row = byId.get(patch.id);
      if (!row) continue;
      rows.push({
        ...row,
        x: patch.x,
        y: patch.y,
        parent_frame_id: patch.parentFrameId !== undefined ? (patch.parentFrameId || null) : row.parent_frame_id,
        updated_at: now,
      });
    }

    if (rows.length > 0) {
      await supabase.from("objects").upsert(rows, { onConflict: "id" });
    }
  }

  return patches.length;
}

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

function annotateObjectRow(row: any) {
  const hex: string = row.color ?? "";
  const name = colorLabel(hex);
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
}

function annotateConnectorRow(row: any) {
  return {
    id: row.id,
    fromId: row.from_id ?? "",
    toId: row.to_id ?? "",
    style: row.style,
    color: row.color ?? null,
    strokeWidth: row.stroke_width ?? null,
  };
}

export async function fetchBoardSummary(boardId: string) {
  const supabase = getSupabaseAdmin();

  const [objRes, connRes] = await Promise.all([
    supabase
      .from("objects")
      .select("id, type, x, y, width, height, text, parent_frame_id")
      .eq("board_id", boardId),
    supabase.from("connectors").select("id").eq("board_id", boardId),
  ]);

  const objects = objRes.data || [];
  const typeCounts: Record<string, number> = {};
  const childCounts: Record<string, number> = {};

  for (const obj of objects) {
    const type = typeof obj.type === "string" ? obj.type : "unknown";
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (obj.parent_frame_id) {
      childCounts[obj.parent_frame_id] = (childCounts[obj.parent_frame_id] ?? 0) + 1;
    }
  }

  const frames = objects
    .filter((o: any) => o.type === "frame")
    .slice(0, 120)
    .map((frame: any) => ({
      id: frame.id,
      text: frame.text || "",
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      childCount: childCounts[frame.id] ?? 0,
    }));

  return {
    objectCount: objects.length,
    connectorCount: (connRes.data || []).length,
    typeCounts,
    frames,
  };
}

export async function fetchObjectsByIds(
  boardId: string,
  ids: string[],
  types?: string[]
) {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("objects")
    .select("*")
    .eq("board_id", boardId)
    .in("id", ids);

  if (types && types.length > 0) {
    query = query.in("type", types);
  }

  const { data } = await query;
  return (data || []).map(annotateObjectRow);
}

export async function fetchObjectsInBbox(
  boardId: string,
  bbox: { x1: number; y1: number; x2: number; y2: number },
  options: { types?: string[]; limit?: number } = {}
) {
  const supabase = getSupabaseAdmin();
  const minX = Math.min(bbox.x1, bbox.x2);
  const maxX = Math.max(bbox.x1, bbox.x2);
  const minY = Math.min(bbox.y1, bbox.y2);
  const maxY = Math.max(bbox.y1, bbox.y2);

  // PostgREST can't filter on computed expressions like (x + width).
  // To catch objects whose body overlaps the viewport even when their
  // origin (top-left) is outside it, we widen the query bounds by a
  // generous padding. Frames can be 800-1200px; stickies ~150px.
  // This over-fetches slightly but never misses visible objects.
  const ORIGIN_PADDING = 1200;

  let query = supabase
    .from("objects")
    .select("*")
    .eq("board_id", boardId)
    .gte("x", minX - ORIGIN_PADDING)
    .lte("x", maxX)
    .gte("y", minY - ORIGIN_PADDING)
    .lte("y", maxY);

  if (options.types && options.types.length > 0) {
    query = query.in("type", options.types);
  }

  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.min(Math.max(1, Math.floor(options.limit)), 500)
      : 120;

  const { data } = await query.limit(limit);

  // Post-filter: exclude objects whose right/bottom edge is still
  // outside the viewport (the padding may have over-fetched).
  return (data || [])
    .filter((row: any) => {
      const right = (row.x ?? 0) + (row.width ?? 0);
      const bottom = (row.y ?? 0) + (row.height ?? 0);
      return right >= minX && bottom >= minY;
    })
    .map(annotateObjectRow);
}

export async function fetchFrameWithChildren(
  boardId: string,
  frameId: string,
  options: { types?: string[]; limit?: number } = {}
) {
  const supabase = getSupabaseAdmin();

  const effectiveLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.min(Math.max(1, Math.floor(options.limit)), 500)
      : 120;

  // Build children query — apply type filter at DB level so the limit
  // operates on matching rows, not a mix of all types.
  let childrenQuery = supabase
    .from("objects")
    .select("*")
    .eq("board_id", boardId)
    .eq("parent_frame_id", frameId);

  if (options.types && options.types.length > 0) {
    childrenQuery = childrenQuery.in("type", options.types);
  }

  const [frameRes, childrenRes] = await Promise.all([
    supabase
      .from("objects")
      .select("*")
      .eq("board_id", boardId)
      .eq("id", frameId)
      .maybeSingle(),
    childrenQuery.limit(effectiveLimit),
  ]);

  if (!frameRes.data) return null;

  return {
    frame: annotateObjectRow(frameRes.data),
    children: (childrenRes.data || []).map(annotateObjectRow),
  };
}

export async function fetchBoardState(boardId: string) {
  const supabase = getSupabaseAdmin();

  const [objRes, connRes] = await Promise.all([
    supabase.from("objects").select("*").eq("board_id", boardId),
    supabase.from("connectors").select("*").eq("board_id", boardId),
  ]);

  const objects = (objRes.data || []).map(annotateObjectRow);
  const connectors = (connRes.data || []).map(annotateConnectorRow);

  return {
    objectCount: objects.length,
    connectorCount: connectors.length,
    objects,
    connectors,
  };
}
