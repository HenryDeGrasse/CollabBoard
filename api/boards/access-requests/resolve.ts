import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, AuthError } from "../../_lib/auth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";

/**
 * POST /api/boards/access-requests/resolve
 * Body: { requestId, decision: "approve" | "deny" }
 * Owner-only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const uid = await verifyToken(req.headers.authorization as string | null);
    const supabase = getSupabaseAdmin();

    const { requestId, decision } = (req.body ?? {}) as {
      requestId?: string;
      decision?: "approve" | "deny";
    };

    if (!requestId) return res.status(400).json({ error: "requestId is required" });
    if (decision !== "approve" && decision !== "deny") {
      return res.status(400).json({ error: "decision must be approve or deny" });
    }

    const { data: request, error: reqError } = await supabase
      .from("board_access_requests")
      .select("id, board_id, requester_id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (reqError) throw reqError;
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") {
      return res.status(409).json({ error: "Request has already been resolved" });
    }

    // Owner check
    const { data: callerMembership } = await supabase
      .from("board_members")
      .select("role")
      .eq("board_id", request.board_id)
      .eq("user_id", uid)
      .maybeSingle();

    if (!callerMembership || callerMembership.role !== "owner") {
      return res.status(403).json({ error: "Only board owners can resolve access requests" });
    }

    if (decision === "approve") {
      // Grant membership (idempotent)
      const { data: existingMember } = await supabase
        .from("board_members")
        .select("role")
        .eq("board_id", request.board_id)
        .eq("user_id", request.requester_id)
        .maybeSingle();

      if (!existingMember) {
        const { error: insertError } = await supabase
          .from("board_members")
          .insert({
            board_id: request.board_id,
            user_id: request.requester_id,
            role: "editor",
          });

        if (insertError && (insertError as any).code !== "23505") {
          throw insertError;
        }
      }
    }

    const { error: updateError } = await supabase
      .from("board_access_requests")
      .update({
        status: decision === "approve" ? "approved" : "denied",
        resolved_at: new Date().toISOString(),
        resolved_by: uid,
      })
      .eq("id", requestId);

    if (updateError) throw updateError;

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error("[boards/access-requests/resolve]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
