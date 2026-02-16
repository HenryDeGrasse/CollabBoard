import OpenAI from "openai";
import * as tools from "./tools";

const SYSTEM_PROMPT = `You are an AI assistant that manipulates a collaborative whiteboard. You have access to tools for creating and manipulating board objects.

Current board state is provided as context. Use it to understand existing objects when the user references them (e.g., "move the pink stickies" or "resize the frame").

For complex commands (SWOT analysis, retro board, journey map), plan your tool calls to create a well-organized layout. Use consistent spacing (e.g., 220px between objects, 300px between frames).

When placing new objects, avoid overlapping existing objects. Use the board state to find open space.

Available colors: yellow (#FBBF24), pink (#F472B6), blue (#3B82F6), green (#22C55E), orange (#F97316), purple (#A855F7), red (#EF4444), gray (#9CA3AF), white (#FFFFFF).

Always respond with tool calls. Do not respond with text-only messages.`;

const TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "createStickyNote",
      description: "Creates a sticky note on the board. Returns the objectId.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content of the sticky note" },
          x: { type: "number", description: "X position on the canvas" },
          y: { type: "number", description: "Y position on the canvas" },
          color: { type: "string", description: "Hex color code (e.g., #FBBF24)" },
        },
        required: ["text", "x", "y", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createShape",
      description: "Creates a shape (rectangle, circle, or line) on the board.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["rectangle", "circle", "line"], description: "Shape type" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: { type: "number", description: "Width" },
          height: { type: "number", description: "Height" },
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
      description: "Creates a named frame/container on the board.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Frame title" },
          x: { type: "number", description: "X position" },
          y: { type: "number", description: "Y position" },
          width: { type: "number", description: "Width" },
          height: { type: "number", description: "Height" },
        },
        required: ["title", "x", "y", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createConnector",
      description: "Creates a line or arrow between two objects.",
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
      description: "Moves an object to new coordinates.",
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
      description: "Resizes an object.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object to resize" },
          width: { type: "number", description: "New width" },
          height: { type: "number", description: "New height" },
        },
        required: ["objectId", "width", "height"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateText",
      description: "Updates the text content of a sticky note, text element, or frame title.",
      parameters: {
        type: "object",
        properties: {
          objectId: { type: "string", description: "ID of the object" },
          newText: { type: "string", description: "New text content" },
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
      description: "Returns all current board objects for context. Use this to understand what's on the board before making changes.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

interface ExecutionResult {
  objectsCreated: string[];
  objectsModified: string[];
  message: string;
}

export async function executeAICommand(
  command: string,
  boardId: string,
  userId: string,
  openaiApiKey: string
): Promise<ExecutionResult> {
  const openai = new OpenAI({ apiKey: openaiApiKey });

  // Get current board state for context
  const boardState = await tools.getBoardState(boardId);
  const boardContext = Object.values(boardState).length > 0
    ? `\n\nCurrent board objects:\n${JSON.stringify(Object.values(boardState).map((obj: any) => ({
        id: obj.id,
        type: obj.type,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        color: obj.color,
        text: obj.text,
      })), null, 2)}`
    : "\n\nThe board is currently empty.";

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT + boardContext },
    { role: "user", content: command },
  ];

  const objectsCreated: string[] = [];
  const objectsModified: string[] = [];
  let iterationCount = 0;
  const MAX_ITERATIONS = 5;

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: iterationCount === 1 ? "required" : "auto",
    });

    const choice = response.choices[0];
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      // No more tool calls, we're done
      return {
        objectsCreated,
        objectsModified,
        message: choice.message.content || `Completed: ${objectsCreated.length} created, ${objectsModified.length} modified`,
      };
    }

    // Add assistant message with tool calls
    messages.push(choice.message);

    // Execute each tool call
    for (const toolCall of choice.message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      let result: any;

      switch (toolCall.function.name) {
        case "createStickyNote":
          result = await tools.createStickyNote(boardId, args.text, args.x, args.y, args.color, userId);
          if (result.objectId) objectsCreated.push(result.objectId);
          break;
        case "createShape":
          result = await tools.createShape(boardId, args.type, args.x, args.y, args.width, args.height, args.color, userId);
          if (result.objectId) objectsCreated.push(result.objectId);
          break;
        case "createFrame":
          result = await tools.createFrame(boardId, args.title, args.x, args.y, args.width, args.height, userId);
          if (result.objectId) objectsCreated.push(result.objectId);
          break;
        case "createConnector":
          result = await tools.createConnector(boardId, args.fromId, args.toId, args.style);
          if (result.objectId) objectsCreated.push(result.objectId);
          break;
        case "moveObject":
          result = await tools.moveObject(boardId, args.objectId, args.x, args.y);
          if (result.objectId) objectsModified.push(result.objectId);
          break;
        case "resizeObject":
          result = await tools.resizeObject(boardId, args.objectId, args.width, args.height);
          if (result.objectId) objectsModified.push(result.objectId);
          break;
        case "updateText":
          result = await tools.updateText(boardId, args.objectId, args.newText);
          if (result.objectId) objectsModified.push(result.objectId);
          break;
        case "changeColor":
          result = await tools.changeColor(boardId, args.objectId, args.color);
          if (result.objectId) objectsModified.push(result.objectId);
          break;
        case "getBoardState":
          result = await tools.getBoardState(boardId);
          break;
        default:
          result = { error: `Unknown tool: ${toolCall.function.name}` };
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    objectsCreated,
    objectsModified,
    message: `Completed: ${objectsCreated.length} objects created, ${objectsModified.length} modified`,
  };
}
