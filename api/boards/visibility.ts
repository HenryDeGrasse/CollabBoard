/**
 * POST /api/boards/visibility   { boardId, visibility: "public" | "private" }
 *
 * Updates the board's visibility. Owner-only.
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
    const { boardId, visibility } = (req.body ?? {}) as {
      boardId?: string;
      visibility?: string;
    };

    if (!boardId) return res.status(400).json({ error: "boardId is required" });
    if (visibility !== "public" && visibility !== "private") {
      return res.status(400).json({ error: "visibility must be 'public' or 'private'" });
    }

    const supabase = getSupabaseAdmin();

    // Only owners can change visibility
    const { data: membership } = await supabase
      .from("board_members")
      .select("role")
      .eq("board_id", boardId)
      .eq("user_id", uid)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: "Not a member of this board" });
    if (membership.role !== "owner") {
      return res.status(403).json({ error: "Only the board owner can change visibility" });
    }

    const { error } = await supabase
      .from("boards")
      .update({ visibility })
      .eq("id", boardId);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error("[boards/visibility]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
