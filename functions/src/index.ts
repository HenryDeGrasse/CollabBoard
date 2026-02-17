import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { executeAICommand } from "./ai-agent";
import { assertCanWriteBoard } from "./auth";

admin.initializeApp();

const openaiApiKey = defineString("OPENAI_API_KEY");

// Rate limiting map (in-memory, per-instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (entry.count >= 10) {
    return false;
  }

  entry.count++;
  return true;
}

interface AICommandRequest {
  commandId: string;
  boardId: string;
  command: string;
  viewport: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    centerX: number;
    centerY: number;
    scale: number;
  };
  selectedObjectIds: string[];
  pointer?: { x: number; y: number };
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

    const uid = request.auth.uid;
    const data = request.data as AICommandRequest;

    // Validate payload
    if (!data.commandId || !data.boardId || !data.command || !data.viewport) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    if (data.command.length > 1000) {
      throw new HttpsError("invalid-argument", "Command too long (max 1000 chars)");
    }

    // Authorize: user can write to this board
    try {
      await assertCanWriteBoard(uid, data.boardId);
    } catch (error: any) {
      throw new HttpsError("permission-denied", error.message || "Not authorized");
    }

    // Rate limit
    if (!checkRateLimit(uid)) {
      throw new HttpsError("resource-exhausted", "Rate limit exceeded (10 commands/minute)");
    }

    // Idempotency check
    const db = admin.database();
    const runRef = db.ref(`aiRuns/${data.boardId}/${data.commandId}`);
    const existingRun = await runRef.once("value");

    if (existingRun.exists()) {
      const runData = existingRun.val();
      if (runData.status === "completed" && runData.response) {
        return runData.response;
      }
      if (runData.status === "started" && Date.now() - runData.startedAt < 30000) {
        throw new HttpsError("already-exists", "Command already in progress");
      }
    }

    // Mark as started
    await runRef.set({
      status: "started",
      uid,
      command: data.command,
      startedAt: Date.now(),
    });

    try {
      // Execute AI command
      const result = await executeAICommand(
        data.command,
        data.boardId,
        uid,
        data.viewport,
        data.selectedObjectIds || [],
        openaiApiKey.value()
      );

      // Build response
      const response = {
        success: result.success,
        message: result.message,
        objectsCreated: result.objectsCreated,
        objectsUpdated: result.objectsUpdated,
        objectsDeleted: result.objectsDeleted,
        focus: result.focus,
        runId: data.commandId,
      };

      // Log usage
      await db.ref(`aiLogs/${data.boardId}/${data.commandId}`).set({
        uid,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        toolCallsCount: result.toolCallsCount,
        objectsCreated: result.objectsCreated.length,
        objectsUpdated: result.objectsUpdated.length,
        durationMs: result.durationMs,
        command: data.command,
        timestamp: Date.now(),
      });

      // Mark run as completed
      await runRef.update({ status: "completed", response });

      return response;
    } catch (error: any) {
      await runRef.update({ status: "failed", error: error.message });
      console.error("AI Agent error:", error);
      throw new HttpsError("internal", error.message || "AI command failed");
    }
  }
);
