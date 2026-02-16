import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { executeAICommand } from "./ai-agent";

admin.initializeApp();

const openaiApiKey = defineString("OPENAI_API_KEY");

// Rate limiting map (in-memory, per-instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (entry.count >= 10) {
    return false;
  }

  entry.count++;
  return true;
}

export const aiAgent = onCall(
  {
    timeoutSeconds: 60,
    memory: "512MiB",
    maxInstances: 10,
  },
  async (request) => {
    // Auth check
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const { command, boardId, userId } = request.data;

    if (!command || !boardId || !userId) {
      throw new HttpsError("invalid-argument", "Missing required fields: command, boardId, userId");
    }

    // Rate limit
    if (!checkRateLimit(userId)) {
      throw new HttpsError("resource-exhausted", "Rate limit exceeded. Max 10 commands per minute.");
    }

    try {
      const result = await executeAICommand(command, boardId, userId, openaiApiKey.value());

      return {
        success: true,
        message: result.message,
        objectsCreated: result.objectsCreated,
        objectsModified: result.objectsModified,
      };
    } catch (error: any) {
      console.error("AI Agent error:", error);
      throw new HttpsError("internal", error.message || "AI command failed");
    }
  }
);
