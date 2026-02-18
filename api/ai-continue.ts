import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./_lib/auth.js";
import { loadJob } from "./_lib/ai/versioning.js";
import { executeAICommand } from "./_lib/ai/agent.js";

/**
 * POST /api/ai-continue
 * Resume a previously started AI job that was interrupted.
 *
 * Body: { boardId, commandId, viewport, selectedIds }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const uid = await authenticateRequest(req);
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { boardId, commandId, viewport, selectedIds } = req.body || {};

  if (!boardId || !commandId) {
    return res.status(400).json({ error: "boardId and commandId are required" });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return res.status(500).json({ error: "OpenAI API key not configured" });
  }

  try {
    // Check if the job exists and is resumable
    const job = await loadJob(boardId, commandId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (job.status === "completed") {
      return res.status(200).json({
        success: true,
        message: "Command already completed.",
        objectsCreated: [],
        objectsUpdated: [],
        objectsDeleted: [],
      });
    }

    // Re-execute the command (idempotency keys prevent duplicate objects)
    const result = await executeAICommand(
      job.command,
      boardId,
      uid,
      viewport || { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      selectedIds || [],
      openaiApiKey,
      commandId
    );

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("AI continue error:", err);
    return res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}
