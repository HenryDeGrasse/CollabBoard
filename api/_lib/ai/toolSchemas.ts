import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "createStickyNote",
      description:
        "Create a sticky note. Pass parentFrameId to place inside a frame (auto-layout, x/y ignored).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content" },
          x: { type: "number", description: "X position (ignored with parentFrameId)" },
          y: { type: "number", description: "Y position (ignored with parentFrameId)" },
          color: {
            type: "string",
            description: "Hex color or palette name",
          },
          parentFrameId: {
            type: "string",
            description: "Frame ID to place inside (auto-positioned)",
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
        "Create a rectangle, circle, or line. Size via width+height or two corners (x,y)→(x2,y2). Pass parentFrameId for frame auto-layout.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["rectangle", "circle", "line"], description: "Shape type" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          x2: { type: "number", description: "Opposite corner X (optional)" },
          y2: { type: "number", description: "Opposite corner Y (optional)" },
          width: { type: "number", description: "Width (50–2000)" },
          height: { type: "number", description: "Height (50–2000)" },
          color: { type: "string", description: "Hex color" },
          parentFrameId: { type: "string", description: "Frame ID to place inside" },
        },
        required: ["type", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createFrame",
      description:
        "Create a named frame/container. Pass expectedChildCount to auto-size. Returns objectId for use as parentFrameId.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Frame title" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: { type: "number", description: "Width (200–2000)" },
          height: { type: "number", description: "Height (150–2000)" },
          expectedChildCount: { type: "number", description: "Auto-size for this many children" },
        },
        required: ["title", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "addObjectToFrame",
      description: "Move an object into a frame (auto-positioned in grid).",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "Object to move" },
          frameId: { type: "string", description: "Target frame" },
        },
        required: ["objectId", "frameId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "removeObjectFromFrame",
      description: "Remove an object from its parent frame.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "Object to remove from frame" },
        },
        required: ["objectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createConnector",
      description: "Create an arrow or line connecting two objects.",
      parameters: {
        type: "object",
        properties: {
          fromId: { type: "string", description: "Source object ID" },
          toId: { type: "string", description: "Target object ID" },
          style: { type: "string", enum: ["arrow", "line"], description: "Style" },
        },
        required: ["fromId", "toId", "style"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "moveObject",
      description: "Move an object to new coordinates.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "Object ID" },
          x: { type: "number", description: "New X" },
          y: { type: "number", description: "New Y" },
        },
        required: ["objectId", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resizeObject",
      description: "Resize an object.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "Object ID" },
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
      description: "Update text content of a sticky, shape, or frame title.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "Object ID" },
          newText: { type: "string", description: "New text (max 500 chars)" },
        },
        required: ["objectId", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "changeColor",
      description: "Change an object's fill color.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "Object ID" },
          color: { type: "string", description: "New hex color" },
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
        'Delete objects. Modes: "all" wipes board, "by_ids" deletes specific objects, "by_type" deletes by type. Connectors auto-cleaned.',
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["all", "by_ids", "by_type"], description: "Strategy" },
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: 'IDs (mode "by_ids")',
          },
          objectType: {
            type: "string",
            enum: ["sticky", "shape", "rectangle", "circle", "frame", "connector"],
            description: 'Type (mode "by_type")',
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
        'Create multiple objects in one call. Supports sticky, rectangle, circle, frame. Use parentFrameId for frame placement, omit x/y for auto-grid. Color: hex, "random", or omit for default.',
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["sticky", "rectangle", "circle", "frame"], description: "Object type" },
                text: { type: "string", description: "Text or frame title" },
                color: { type: "string", description: 'Hex, "random", or omit' },
                width: { type: "number", description: "Width (shapes/frames)" },
                height: { type: "number", description: "Height (shapes/frames)" },
                x2: { type: "number", description: "Opposite corner X" },
                y2: { type: "number", description: "Opposite corner Y" },
                parentFrameId: { type: "string", description: "Frame ID to place inside" },
                x: { type: "number", description: "X position" },
                y: { type: "number", description: "Y position" },
                expectedChildCount: { type: "number", description: "Frames: auto-size for N children" },
              },
              required: ["type"],
            },
            description: "Objects to create",
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
        "Arrange objects into grid, row, or column layout. Server-side positioning — no coordinate math needed.",
      parameters: {
        type: "object",
        properties: {
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: "Object IDs to arrange",
          },
          layout: {
            type: "string",
            enum: ["grid", "row", "column"],
            description: "Layout style",
          },
          spacing: { type: "number", description: "Gap in pixels (default 20)" },
        },
        required: ["objectIds", "layout"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rearrangeFrame",
      description: "Tidy all children in a frame into a clean grid. Frame auto-expands.",
      parameters: {
        type: "object",
        properties: {
          frameId: { type: "string", description: "Frame ID" },
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
        'Fetch board objects. Scopes: "all" (up to 100), "viewport", "selected", "frame" (needs frameId), "ids" (needs objectIds). Optional typeFilter.',
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["all", "viewport", "selected", "frame", "ids"], description: "Scope" },
          frameId: { type: "string", description: 'Frame ID (scope "frame")' },
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: 'Object IDs (scope "ids")',
          },
          typeFilter: {
            type: "string",
            enum: ["sticky", "shape", "rectangle", "circle", "frame", "connector"],
            description: "Type filter",
          },
        },
        required: ["scope"],
      },
    },
  },
];
