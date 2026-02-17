import { getFunctions, httpsCallable } from "firebase/functions";
import app from "./firebase";
import type { AICommandRequest, AICommandResponse } from "../types/ai";

const functions = getFunctions(app);

/**
 * Send an AI command to Firebase Cloud Function.
 * Auth is handled automatically by Firebase SDK.
 */
export async function sendAICommand(
  request: Omit<AICommandRequest, "commandId"> & { commandId?: string }
): Promise<AICommandResponse> {
  const commandId = request.commandId || crypto.randomUUID();

  const payload: AICommandRequest = {
    commandId,
    boardId: request.boardId,
    command: request.command,
    viewport: request.viewport,
    selectedObjectIds: request.selectedObjectIds,
    pointer: request.pointer,
  };

  try {
    const aiAgent = httpsCallable<AICommandRequest, AICommandResponse>(functions, "aiAgent");
    const result = await aiAgent(payload);
    return result.data;
  } catch (error: any) {
    const message = error.message || "Unknown error";
    return {
      success: false,
      message: "AI command failed",
      objectsCreated: [],
      objectsUpdated: [],
      objectsDeleted: [],
      runId: commandId,
      error: message,
    };
  }
}
