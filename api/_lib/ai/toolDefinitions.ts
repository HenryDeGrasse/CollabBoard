/**
 * OpenAI function-calling tool schemas.
 *
 * Pure data — no execution logic. Each entry describes one tool the LLM can
 * invoke. The actual execution lives in the executor modules.
 */
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  // ── Layout Templates ─────────────────────────────────────────
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
              bottomRight: { type: "string", description: "Bottom-right quadrant title" },
            },
            required: ["topLeft", "topRight", "bottomLeft", "bottomRight"],
          },
          items: {
            type: "object",
            properties: {
              topLeft: { type: "array", items: { type: "string" }, description: "Items for the top-left quadrant" },
              topRight: { type: "array", items: { type: "string" }, description: "Items for the top-right quadrant" },
              bottomLeft: { type: "array", items: { type: "string" }, description: "Items for the bottom-left quadrant" },
              bottomRight: { type: "array", items: { type: "string" }, description: "Items for the bottom-right quadrant" },
            },
          },
          quadrantSourceIds: {
            type: "object",
            properties: {
              topLeft: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the top-left quadrant" },
              topRight: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the top-right quadrant" },
              bottomLeft: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the bottom-left quadrant" },
              bottomRight: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into the bottom-right quadrant" },
            },
            description:
              "Optional. Existing object IDs to REPOSITION into each quadrant instead of creating new items. " +
              "When provided, the items object is ignored. Use when the user says 'reorganize', 'convert', or 'turn into'.",
          },
          startX: { type: "number", description: "Starting X position on the canvas" },
          startY: { type: "number", description: "Starting Y position on the canvas" },
        },
        required: ["title", "quadrantLabels"],
      },
    },
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
                items: { type: "array", items: { type: "string" }, description: "Sticky note items for this column" },
              },
              required: ["title"],
            },
            description: "Array of columns with their respective titles and items",
          },
          sourceIds: {
            type: "array",
            items: {
              type: "object",
              properties: {
                columnTitle: { type: "string", description: "Which column to place these objects in (must match a title in columns)" },
                objectIds: { type: "array", items: { type: "string" }, description: "IDs of existing objects to move into this column" },
              },
              required: ["columnTitle", "objectIds"],
            },
            description:
              "Optional. Existing object IDs to REPOSITION into columns instead of creating new items. " +
              "When provided, the items arrays in columns are ignored. Use when the user says 'reorganize', 'convert', or 'turn into'.",
          },
          startX: { type: "number", description: "Starting X position on the canvas" },
          startY: { type: "number", description: "Starting Y position on the canvas" },
        },
        required: ["title", "columns"],
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
                children: { type: "array", items: { type: "string" }, description: "Sub-topic texts hanging off this branch" },
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
                splitLabels: { type: "array", items: { type: "string" }, description: "Labels for each column in the split (e.g. ['Sidebar', 'Main Content'])" },
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

  // ── CRUD Tools ───────────────────────────────────────────────
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
                type: { type: "string", enum: ["sticky", "rectangle", "circle", "text", "frame"], description: "Object type" },
                x: { type: "number", description: "X position on the canvas" },
                y: { type: "number", description: "Y position on the canvas" },
                width: { type: "number", description: "Width in pixels (default: sticky=150, rectangle=200, circle=120, text=200, frame=800)" },
                height: { type: "number", description: "Height in pixels (default: sticky=150, rectangle=150, circle=120, text=50, frame=600)" },
                color: {
                  type: "string",
                  description: "Hex color. Sticky colors: #FAD84E (yellow), #F5A8C4 (pink), #7FC8E8 (blue), #9DD9A3 (green), #E5E5E0 (grey), #F9F9F7 (offwhite). Shape colors: #111111 (black), #CC0000 (red), #3B82F6 (blue), #404040 (darkgrey), #E5E5E0 (grey). Frame default: #F9F9F7.",
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
          type: { type: "string", enum: ["sticky", "rectangle", "circle", "text", "frame"], description: "Object type for all created objects" },
          count: { type: "number", description: "Number of objects to create (max 500)" },
          color: { type: "string", description: "Hex color or color name for all objects. Sticky colors: #FAD84E (yellow), #F5A8C4 (pink), #7FC8E8 (blue), #9DD9A3 (green), #E5E5E0 (grey), #F9F9F7 (offwhite)." },
          layout: { type: "string", enum: ["grid", "vertical", "horizontal"], description: "How to arrange the objects. Default is 'vertical' when parentFrameId is set (stacks items in a single column to stay within frame width), 'grid' otherwise." },
          columns: { type: "number", description: "Number of columns for grid layout (default: auto based on count)" },
          gap: { type: "number", description: "Spacing between objects in pixels (default: 20)" },
          startX: { type: "number", description: "Starting X position on the canvas (default: 100)" },
          startY: { type: "number", description: "Starting Y position on the canvas (default: 100)" },
          width: { type: "number", description: "Width of each object in pixels (uses type default if omitted)" },
          height: { type: "number", description: "Height of each object in pixels (uses type default if omitted)" },
          contentPrompt: { type: "string", description: "AI prompt to generate unique text for EACH object. Example: 'a unique fun fact about space'. The server will use AI to generate the requested number of unique items." },
          textPattern: { type: "string", description: "Pattern with {i} placeholder for sequential numbering. Example: 'Task {i}' produces 'Task 1', 'Task 2', etc. Used when contentPrompt is not provided." },
          parentFrameId: { type: "string", description: "ID of the parent frame if objects should be contained within one. When set, layout defaults to 'vertical' to keep items stacked within the frame's width." },
        },
        required: ["type", "count"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_connectors",
      description: "Create one or more connectors (arrows or lines) between objects. Use fromId/toId to connect existing objects. Use fromPoint/toPoint for free-floating endpoints.",
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
                fromPoint: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, description: "Free-floating source anchor (used when fromId is empty)" },
                toPoint: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, description: "Free-floating target anchor (used when toId is empty)" },
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
      description: "Update one or more existing objects. Pass an array of patches with the object ID and the fields to change. Only include fields you want to modify.",
      parameters: {
        type: "object",
        properties: {
          patches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "ID of the object to update" },
                x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" },
                color: { type: "string" }, text: { type: "string" }, rotation: { type: "number" },
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
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Array of object IDs to delete" } }, required: ["ids"] },
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
          type: { type: "string", enum: ["sticky", "rectangle", "circle", "line", "frame", "text"], description: "Only delete objects of this type. Omit to match all types." },
          color: { type: "string", description: "Only delete objects with this color. Accepts a hex code OR a color name: yellow (#FAD84E), pink (#F5A8C4), blue (#7FC8E8), green (#9DD9A3), grey (#E5E5E0), offwhite (#F9F9F7), red (#CC0000), black (#111111)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_connectors",
      description: "Delete one or more connectors from the board by their IDs.",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Array of connector IDs to delete" } }, required: ["ids"] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_objects_by_filter",
      description:
        "Update all objects matching a color and/or type filter without needing to know their IDs. " +
        "Use this for commands like 'make all yellow stickies green', 'resize all rectangles', 'rename all blue notes to Done'. " +
        "Prefer this over update_objects when the user refers to objects by color or type rather than by specific ID.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "object", description: "Criteria to match objects. At least one field required.",
            properties: {
              type: { type: "string", enum: ["sticky", "rectangle", "circle", "line", "frame", "text"], description: "Only match objects of this type." },
              color: { type: "string", description: "Only match objects with this color (hex or name: purple, yellow, etc.)." },
            },
          },
          updates: {
            type: "object", description: "Fields to apply to every matched object.",
            properties: { color: { type: "string" }, text: { type: "string" }, width: { type: "number" }, height: { type: "number" }, rotation: { type: "number" } },
          },
        },
        required: ["filter", "updates"],
      },
    },
  },

  // ── Board Operations ─────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "fit_frames_to_contents",
      description: "Resize one or more frames so they tightly wrap all objects inside them. Pass frame IDs, or omit ids to fit ALL frames on the board. Use after adding or moving objects inside a frame.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "Frame IDs to fit. Omit or pass [] to fit all frames." },
          padding: { type: "number", description: "Extra space (px) around contents on each side. Default: 40. Top gets an extra 30px for the frame title." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_board",
      description: "Delete ALL objects and connectors from the board. Use only when the user explicitly asks to clear, wipe, or start fresh. This is irreversible.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to_objects",
      description: "Pan and zoom the user's camera so the given objects are centered and visible on screen. Use when the user says 'show me', 'go to', 'zoom to', 'find', etc. Pass ids to navigate to specific objects, or omit to fit the entire board.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "Object IDs to navigate to. Omit or pass [] to fit all objects on the board." },
          padding: { type: "number", description: "Fraction of screen to use as margin (0–1, default 0.82)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "arrange_objects",
      description: "Align or distribute objects geometrically. Pass object IDs, or omit ids to use the currently selected objects. Use when the user says 'align', 'distribute', 'space evenly', 'make a grid', 'line up', 'organize'.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "Object IDs to arrange. Omit to use current selection." },
          operation: {
            type: "string",
            enum: ["align-left", "align-right", "align-center-x", "align-top", "align-bottom", "align-center-y", "distribute-horizontal", "distribute-vertical", "grid"],
            description: "align-left/right/center-x: snap edges. align-top/bottom/center-y: snap edges. distribute-horizontal/vertical: equal gaps. grid: arrange in a grid.",
          },
          columns: { type: "number", description: "Number of columns for grid layout (default: ceil(sqrt(n)))." },
          gap: { type: "number", description: "Pixel gap between objects for grid/distribute (default: 20)." },
        },
        required: ["operation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_objects",
      description: "Clone one or more objects (and any connectors between them) with a position offset. Use when the user says 'duplicate', 'copy', 'clone'. Pass ids, or omit to duplicate the currently selected objects.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "Object IDs to duplicate. Omit to use current selection." },
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
      description: "Find objects on the board by text content, type, color, or parent frame. Returns matching object IDs and properties. Prefer this over read_board_state when you only need a subset of objects.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Search for objects whose text contains this string (case-insensitive)." },
          type: { type: "string", enum: ["sticky", "rectangle", "circle", "line", "frame", "text"], description: "Only return objects of this type." },
          color: { type: "string", description: "Only return objects of this color (hex or name)." },
          parentFrameId: { type: "string", description: "Only return objects contained within this frame ID." },
          limit: { type: "number", description: "Maximum number of results to return (default: 100)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_context",
      description: "Read scoped board context instead of the full board when possible. Use this for selected objects, viewport objects, frame children, object IDs, or a compact board summary.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["board_summary", "selected", "viewport", "frame", "ids"], description: "Which context slice to fetch." },
          ids: { type: "array", items: { type: "string" }, description: "Object IDs (required for scope='ids')." },
          frameId: { type: "string", description: "Frame ID (required for scope='frame')." },
          bbox: {
            type: "object", description: "Bounding box in canvas coordinates for scope='viewport'.",
            properties: { x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } },
            required: ["x1", "y1", "x2", "y2"],
          },
          types: { type: "array", items: { type: "string", enum: ["sticky", "rectangle", "circle", "line", "frame", "text"] }, description: "Optional type filter for object scopes." },
          limit: { type: "number", description: "Max objects to return for viewport/frame scopes (default: 120, max: 500)." },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_board_state",
      description: "Read the current state of the board — all objects and connectors. Use this to verify your changes, find object IDs, or understand the current layout before making modifications.",
      parameters: { type: "object", properties: {} },
    },
  },
];
