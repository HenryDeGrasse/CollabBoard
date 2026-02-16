export interface AICommand {
  command: string;
  boardId: string;
  userId: string;
}

export interface AIResponse {
  success: boolean;
  message: string;
  objectsCreated: string[];
  objectsModified: string[];
  error?: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
