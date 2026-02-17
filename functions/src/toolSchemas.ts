import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "createStickyNote",
      description:
        "Creates a sticky note on the board. Place it near the user's viewport center unless the user specifies a location. Returns the objectId.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content of the sticky note" },
          x: { type: "number", description: "X position on the canvas" },
          y: { type: "number", description: "Y position on the canvas" },
          color: {
            type: "string",
            description: "Hex color code. Available: #FBBF24 (yellow), #F472B6 (pink), #3B82F6 (blue), #22C55E (green), #F97316 (orange), #A855F7 (purple), #EF4444 (red), #9CA3AF (gray)",
          },
        },
        required: ["text", "x", "y", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createShape",
      description: "Creates a shape (rectangle, circle, or line) on the board. Returns the objectId.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["rectangle", "circle", "line"], description: "Shape type" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: { type: "number", description: "Width (50–2000)" },
          height: { type: "number", description: "Height (50–2000)" },
          color: { type: "string", description: "Hex color code" },
        },
        required: ["type", "x", "y", "width", "height", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createFrame",
      description: "Creates a named frame/container on the board. Frames group objects visually. Returns the objectId.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Frame title text" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: { type: "number", description: "Width (200–2000)" },
          height: { type: "number", description: "Height (150–2000)" },
        },
        required: ["title", "x", "y", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createConnector",
      description: "Creates an arrow or line connecting two objects. Returns the connectorId.",
      parameters: {
        type: "object",
        properties: {
          fromId: { type: "string", description: "Source object ID" },
          toId: { type: "string", description: "Target object ID" },
          style: { type: "string", enum: ["arrow", "line"], description: "Connector style" },
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
      description: "Updates the text content of a sticky note, shape, or frame title.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object" },
          newText: { type: "string", description: "New text content (max 500 chars)" },
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
      name: "getBoardState",
      description:
        "Returns all current board objects visible to the user. Use this to understand what's on the board before making changes. Objects include id, type, position, size, color, text.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];
