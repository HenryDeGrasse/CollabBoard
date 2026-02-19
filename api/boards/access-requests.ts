import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, AuthError } from "../_lib/auth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";

/**
 * GET  /api/boards/access-requests?boardId=...
 *   Owner-only: list pending requests for a board
 *
 * POST /api/boards/access-requests { boardId, message? }
 *   Any authenticated user: request access to a private board
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const uid = await verifyToken(req.headers.authorization as string | null);
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const boardId = (req.query.boardId as string | undefined) || "";
      if (!boardId) return res.status(400).json({ error: "boardId is required" });

      // Owner-only access
      const { data: callerMembership } = await supabase
        .from("board_members")
        .select("role")
        .eq("board_id", boardId)
        .eq("user_id", uid)
        .maybeSingle();

      if (!callerMembership || callerMembership.role !== "owner") {
        return res.status(403).json({ error: "Only board owners can view access requests" });
      }

      const { data: requests, error } = await supabase
        .from("board_access_requests")
        .select("id, requester_id, message, created_at")
        .eq("board_id", boardId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error) throw error;

      const requesterIds = (requests ?? []).map((r) => r.requester_id);
      let profileMap: Record<string, string> = {};
      if (requesterIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", requesterIds);

        profileMap = Object.fromEntries(
          (profiles ?? []).map((p: any) => [p.id, p.display_name || "Unknown User"])
        );
      }

      return res.status(200).json({
        requests: (requests ?? []).map((r) => ({
          id: r.id,
          requesterId: r.requester_id,
          requesterName: profileMap[r.requester_id] || "Unknown User",
          message: r.message || "",
          createdAt: r.created_at,
        })),
      });
    }

    if (req.method === "POST") {
      const { boardId, message } = (req.body ?? {}) as {
        boardId?: string;
        message?: string;
      };

      if (!boardId) return res.status(400).json({ error: "boardId is required" });

      // Board exists?
      const { data: board } = await supabase
        .from("boards")
        .select("id")
        .eq("id", boardId)
        .maybeSingle();

      if (!board) return res.status(404).json({ error: "Board not found" });

      // Already member?
      const { data: member } = await supabase
        .from("board_members")
        .select("role")
        .eq("board_id", boardId)
        .eq("user_id", uid)
        .maybeSingle();

      if (member) {
        return res.status(409).json({ error: "You already have access to this board" });
      }

      // Upsert request row for this user/board
      const { error } = await supabase
        .from("board_access_requests")
        .upsert({
          board_id: boardId,
          requester_id: uid,
          message: message?.trim() || null,
          status: "pending",
          resolved_at: null,
          resolved_by: null,
        }, { onConflict: "board_id,requester_id" });

      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error("[boards/access-requests]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
