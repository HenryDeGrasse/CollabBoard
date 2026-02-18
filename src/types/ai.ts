export interface Viewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  scale: number;
}

export interface AICommandRequest {
  commandId: string;
  boardId: string;
  command: string;
  viewport: Viewport;
  selectedObjectIds: string[];
  pointer?: { x: number; y: number };
}

export interface AICommandResponse {
  success: boolean;
  message: string;
  objectsCreated: string[];
  objectsUpdated: string[];
  objectsDeleted: string[];
  focus?: { minX: number; minY: number; maxX: number; maxY: number };
  runId: string;
  route?: {
    source: "fast_path" | "ai_extractor" | "full_agent";
    confidence: number;
    reason: string;
  };
  error?: string;
}

// Legacy types (kept for backward compat)
export interface AICommand {
  command: string;
  boardId: string;
  userId: string;
}

export type AIResponse = AICommandResponse;

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
