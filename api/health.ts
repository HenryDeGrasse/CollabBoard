import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRouteLatencyStats } from "./_lib/ai/runtimeMetrics.js";

/**
 * GET /api/health — simple diagnostic endpoint.
 * Shows which Supabase URL the API server is configured with.
 * Safe: no secrets exposed.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "(not set)";
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  return res.status(200).json({
    ok: true,
    supabaseUrl,
    hasServiceKey,
    hasOpenAI,
    langsmith: {
      tracing: process.env.LANGSMITH_TRACING === "true",
      project: process.env.LANGSMITH_PROJECT || "(not set)",
      hasKey: !!process.env.LANGSMITH_API_KEY,
    },
    aiRouteLatency: getRouteLatencyStats(),
    nodeEnv: process.env.NODE_ENV || "development",
  });
}
