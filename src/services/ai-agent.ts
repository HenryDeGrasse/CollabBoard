import { getFunctions, httpsCallable } from "firebase/functions";
import app from "./firebase";
import type { AICommand, AIResponse } from "../types/ai";

const functions = getFunctions(app);

export async function sendAICommand(
  command: string,
  boardId: string,
  userId: string
): Promise<AIResponse> {
  const aiAgent = httpsCallable<AICommand, AIResponse>(functions, "aiAgent");

  try {
    const result = await aiAgent({ command, boardId, userId });
    return result.data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      message: "AI command failed",
      objectsCreated: [],
      objectsModified: [],
      error: message,
    };
  }
}
