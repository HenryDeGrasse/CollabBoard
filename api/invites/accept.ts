/**
 * POST /api/invites/accept   { token }
 *
 * Validates a board invite token and adds the authenticated caller
 * as an editor of the board. Multi-use: the token is NOT consumed —
 * others can still use it until it expires or the owner revokes it.
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
    const { token } = (req.body ?? {}) as { token?: string };

    if (!token) return res.status(400).json({ error: "token is required" });

    const supabase = getSupabaseAdmin();

    // Look up the invite
    const { data: invite, error: inviteError } = await supabase
      .from("board_invites")
      .select("id, board_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) return res.status(404).json({ error: "Invite not found or has been revoked" });

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: "This invite link has expired" });
    }

    // Check if user is already a member
    const { data: existing } = await supabase
      .from("board_members")
      .select("role")
      .eq("board_id", invite.board_id)
      .eq("user_id", uid)
      .maybeSingle();

    if (existing) {
      // Already a member — just tell them which board to open
      return res.status(200).json({ boardId: invite.board_id, role: existing.role, alreadyMember: true });
    }

    // Add to board as editor (supabaseAdmin bypasses RLS — safe for private boards)
    const { error: insertError } = await supabase
      .from("board_members")
      .insert({ board_id: invite.board_id, user_id: uid, role: "editor" });

    if (insertError) throw insertError;

    return res.status(200).json({ boardId: invite.board_id, role: "editor", alreadyMember: false });
  } catch (err: any) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error("[invites/accept]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
