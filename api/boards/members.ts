/**
 * POST /api/boards/members   { action: "remove", boardId, userId }
 *
 * Removes a member from a board.
 * - Owners can remove anyone except themselves (last-owner guard).
 * - Editors can only remove themselves (leave board).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyToken, AuthError } from "../_lib/auth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const uid = await verifyToken(req.headers.authorization as string | null);
    const { boardId, userId } = (req.body ?? {}) as {
      boardId?: string;
      userId?: string;
    };

    if (!boardId || !userId) {
      return res.status(400).json({ error: "boardId and userId are required" });
    }

    const supabase = getSupabaseAdmin();

    // Get the caller's membership
    const { data: callerMembership } = await supabase
      .from("board_members")
      .select("role")
      .eq("board_id", boardId)
      .eq("user_id", uid)
      .maybeSingle();

    if (!callerMembership) return res.status(403).json({ error: "Not a member of this board" });

    const isOwner = callerMembership.role === "owner";
    const isSelf  = uid === userId;

    // Editors can only remove themselves
    if (!isOwner && !isSelf) {
      return res.status(403).json({ error: "Only owners can remove other members" });
    }

    // Owners cannot remove themselves (would leave board owner-less)
    if (isOwner && isSelf) {
      return res.status(400).json({
        error: "You cannot leave a board you own. Transfer ownership first.",
      });
    }

    const { error } = await supabase
      .from("board_members")
      .delete()
      .eq("board_id", boardId)
      .eq("user_id", userId);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error("[boards/members]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
