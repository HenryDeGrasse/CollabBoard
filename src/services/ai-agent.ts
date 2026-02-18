import { supabase } from "./supabase";
import type { AICommandRequest, AICommandResponse } from "../types/ai";

/**
 * Send an AI command to the Vercel serverless function.
 * Auth token is derived from the current Supabase session.
 */
export async function sendAICommand(
  request: Omit<AICommandRequest, "commandId"> & { commandId?: string }
): Promise<AICommandResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
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
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
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
    const message =
      error instanceof Error ? error.message : "Unknown error";
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

/**
 * Resume a previously interrupted AI command.
 */
export async function continueAICommand(
  boardId: string,
  commandId: string,
  viewport?: AICommandRequest["viewport"],
  selectedObjectIds?: string[]
): Promise<AICommandResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return {
      success: false,
      message: "Not authenticated",
      objectsCreated: [],
      objectsUpdated: [],
      objectsDeleted: [],
      runId: commandId,
      error: "Not authenticated",
    };
  }

  try {
    const res = await fetch("/api/ai-continue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ boardId, commandId, viewport, selectedIds: selectedObjectIds }),
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
      message: "AI resume failed",
      objectsCreated: [],
      objectsUpdated: [],
      objectsDeleted: [],
      runId: commandId,
      error: message,
    };
  }
}
