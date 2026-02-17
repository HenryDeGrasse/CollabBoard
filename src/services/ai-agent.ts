import { getAuth } from "firebase/auth";
import app from "./firebase";
import type { AICommandRequest, AICommandResponse } from "../types/ai";

const auth = getAuth(app);

/**
 * Send an AI command to the Vercel serverless function.
 * Auth token is derived from the current Firebase user (never send userId).
 */
export async function sendAICommand(
  request: Omit<AICommandRequest, "commandId"> & { commandId?: string }
): Promise<AICommandResponse> {
  const user = auth.currentUser;
  if (!user) {
    return {
      success: false,
      message: "Not authenticated",
      objectsCreated: [],
      objectsUpdated: [],
      objectsDeleted: [],
      runId: "",
      error: "Not authenticated",
    };
  }

  const token = await user.getIdToken();
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
    const res = await fetch("/api/ai-agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return {
        success: false,
        message: errorData.error || `Request failed (${res.status})`,
        objectsCreated: [],
        objectsUpdated: [],
        objectsDeleted: [],
        runId: commandId,
        error: errorData.error || `HTTP ${res.status}`,
      };
    }

    return await res.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
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
