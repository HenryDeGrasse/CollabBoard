import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "createStickyNote",
      description:
        "Creates a sticky note on the board. If parentFrameId is provided, the sticky is placed inside that frame using auto-layout (grid arrangement). The frame auto-expands if needed. If no parentFrameId, places at x/y.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content of the sticky note" },
          x: {
            type: "number",
            description:
              "X position (used only when NOT placing inside a frame). Ignored when parentFrameId is set.",
          },
          y: {
            type: "number",
            description:
              "Y position (used only when NOT placing inside a frame). Ignored when parentFrameId is set.",
          },
          color: {
            type: "string",
            description:
              "Hex color code. Available: #FBBF24 (yellow), #F472B6 (pink), #3B82F6 (blue), #22C55E (green), #F97316 (orange), #A855F7 (purple), #EF4444 (red), #9CA3AF (gray)",
          },
          parentFrameId: {
            type: "string",
            description:
              "Optional. ID of the frame to place this sticky inside. When set, the sticky is auto-positioned in the next available grid slot and the frame auto-expands if needed. x/y are ignored.",
          },
        },
        required: ["text", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createShape",
      description:
        "Creates a shape (rectangle, circle, or line) on the board. If parentFrameId is provided, the shape is placed inside that frame using auto-layout.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["rectangle", "circle", "line"],
            description: "Shape type",
          },
          x: { type: "number", description: "X position (ignored when parentFrameId is set)" },
          y: { type: "number", description: "Y position (ignored when parentFrameId is set)" },
          width: { type: "number", description: "Width (50–2000)" },
          height: { type: "number", description: "Height (50–2000)" },
          color: { type: "string", description: "Hex color code" },
          parentFrameId: {
            type: "string",
            description:
              "Optional. ID of the frame to place this shape inside. Auto-positions in grid layout.",
          },
        },
        required: ["type", "width", "height", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createFrame",
      description:
        "Creates a named frame/container on the board. Frames group objects visually. If you know how many objects will go inside, pass expectedChildCount to auto-size the frame with room for one extra row. Returns the frame's objectId — use this as parentFrameId when creating objects inside the frame.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Frame title text" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: {
            type: "number",
            description:
              "Width (200–2000). Overridden by auto-sizing if expectedChildCount is set.",
          },
          height: {
            type: "number",
            description:
              "Height (150–2000). Overridden by auto-sizing if expectedChildCount is set.",
          },
          expectedChildCount: {
            type: "number",
            description:
              "Optional. Number of objects you plan to put inside this frame. The frame auto-sizes to fit this many objects in a grid, plus room for one extra row.",
          },
        },
        required: ["title", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "addObjectToFrame",
      description:
        "Moves an existing object into a frame. Sets parent_frame_id and repositions the object into the next available grid slot inside the frame. The frame auto-expands if needed.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object to move into the frame" },
          frameId: { type: "string", description: "ID of the target frame" },
        },
        required: ["objectId", "frameId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "removeObjectFromFrame",
      description:
        "Removes an object from its parent frame. Clears parent_frame_id. The object stays at its current position.",
      parameters: {
        type: "object",
        properties: {
          objectId: {
            type: "string",
            description: "ID of the object to remove from its frame",
          },
        },
        required: ["objectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createConnector",
      description:
        "Creates an arrow or line connecting two objects. Returns the connectorId.",
      parameters: {
        type: "object",
        properties: {
          fromId: { type: "string", description: "Source object ID" },
          toId: { type: "string", description: "Target object ID" },
          style: {
            type: "string",
            enum: ["arrow", "line"],
            description: "Connector style",
          },
        },
        required: ["fromId", "toId", "style"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moveObject",
      description: "Moves an existing object to new coordinates.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object to move" },
          x: { type: "number", description: "New X position" },
          y: { type: "number", description: "New Y position" },
        },
        required: ["objectId", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resizeObject",
      description: "Resizes an existing object.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object to resize" },
          width: { type: "number", description: "New width (50–2000)" },
          height: { type: "number", description: "New height (50–2000)" },
        },
        required: ["objectId", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateText",
      description:
        "Updates the text content of a sticky note, shape, or frame title.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object" },
          newText: {
            type: "string",
            description: "New text content (max 500 chars)",
          },
        },
        required: ["objectId", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "changeColor",
      description: "Changes the fill color of an object.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object" },
          color: { type: "string", description: "New hex color code" },
        },
        required: ["objectId", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulkDelete",
      description:
        'Deletes objects from the board. Three modes: "all" wipes the entire board (fastest way to start over). "by_ids" deletes specific objects by their IDs. "by_type" deletes all objects of a given type (sticky, shape, rectangle, circle, frame, connector). Connectors attached to deleted objects are cleaned up automatically.',
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["all", "by_ids", "by_type"],
            description: "Deletion strategy",
          },
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: 'IDs of objects to delete (only for mode "by_ids")',
          },
          objectType: {
            type: "string",
            enum: ["sticky", "shape", "rectangle", "circle", "frame", "connector"],
            description:
              'Type of objects to delete (only for mode "by_type"). "shape" deletes all rectangles, circles, and lines.',
          },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulkCreate",
      description:
        'Creates multiple objects in one call — much faster than individual creates. Supports sticky notes, rectangles, circles, and frames. Each item can target a frame (auto-positioned via parentFrameId) or be free-placed (auto-grid when x/y omitted). Color can be a hex code, "random" for a random palette color, or omitted for the default.',
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["sticky", "rectangle", "circle", "frame"],
                  description: "Object type to create",
                },
                text: {
                  type: "string",
                  description: "Text content (sticky note text or frame title)",
                },
                color: {
                  type: "string",
                  description:
                    'Hex color code, or "random" for a random palette color. Default: yellow for stickies, gray for frames.',
                },
                width: {
                  type: "number",
                  description: "Width in pixels (shapes/frames only, ignored for stickies)",
                },
                height: {
                  type: "number",
                  description: "Height in pixels (shapes/frames only, ignored for stickies)",
                },
                parentFrameId: {
                  type: "string",
                  description:
                    "Optional frame ID to place inside (not for frames). Auto-positions in frame grid.",
                },
                x: { type: "number", description: "Optional X position" },
                y: { type: "number", description: "Optional Y position" },
                expectedChildCount: {
                  type: "number",
                  description: "For frames: auto-size to fit this many children",
                },
              },
              required: ["type"],
            },
            description: "Array of objects to create",
          },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "arrangeObjects",
      description:
        "Arranges a set of objects into a clean grid, row, or column layout. Positions are computed server-side — no coordinate math needed. The objects are centered around the center of their current bounding box. Use this after creating free objects, or to tidy up existing objects.",
      parameters: {
        type: "object",
        properties: {
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of the objects to arrange",
          },
          layout: {
            type: "string",
            enum: ["grid", "row", "column"],
            description:
              "Layout style. 'grid' arranges in a square-ish grid, 'row' in a horizontal line, 'column' in a vertical line.",
          },
          spacing: {
            type: "number",
            description: "Gap between objects in pixels (default 20, max 200)",
          },
        },
        required: ["objectIds", "layout"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rearrangeFrame",
      description:
        "Tidies all children inside a frame into a clean grid layout. The frame auto-expands if needed. Use this to clean up a messy frame or after manually moving objects into a frame.",
      parameters: {
        type: "object",
        properties: {
          frameId: {
            type: "string",
            description: "ID of the frame whose children should be rearranged",
          },
        },
        required: ["frameId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getBoardContext",
      description:
        'Fetches board objects with flexible scoping. Use this when the digest summary is not enough. Scopes: "all" returns everything (capped at 100), "viewport" returns visible objects, "selected" returns selected objects, "frame" returns a frame and its children, "ids" returns specific objects. Optionally filter by type.',
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["all", "viewport", "selected", "frame", "ids"],
            description: "What to fetch",
          },
          frameId: {
            type: "string",
            description: 'Frame ID (only for scope "frame")',
          },
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: 'Specific object IDs (only for scope "ids")',
          },
          typeFilter: {
            type: "string",
            enum: ["sticky", "shape", "rectangle", "circle", "frame", "connector"],
            description: "Optional type filter",
          },
        },
        required: ["scope"],
      },
    },
  },
];
