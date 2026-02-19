-- ============================================================
-- Migration: board visibility + invite tokens
-- ============================================================

-- gen_random_bytes is from pgcrypto; enable it if not already present
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add visibility column to boards (defaults to public)
ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));

-- 2. Create board_invites table (multi-use, per-token expiry)
CREATE TABLE IF NOT EXISTS board_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_invites_token   ON board_invites(token);
CREATE INDEX IF NOT EXISTS idx_board_invites_board_id ON board_invites(board_id);

-- 3. RLS on board_invites
ALTER TABLE board_invites ENABLE ROW LEVEL SECURITY;

-- Members of the board can read its invite tokens
DROP POLICY IF EXISTS "board_invites_select" ON board_invites;
CREATE POLICY "board_invites_select" ON board_invites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM board_members
      WHERE board_members.board_id = board_invites.board_id
        AND board_members.user_id  = auth.uid()
    )
  );

-- Members can create invite tokens for their boards
DROP POLICY IF EXISTS "board_invites_insert" ON board_invites;
CREATE POLICY "board_invites_insert" ON board_invites FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM board_members
      WHERE board_members.board_id = board_invites.board_id
        AND board_members.user_id  = auth.uid()
    )
  );

-- Members can delete (revoke) invite tokens
DROP POLICY IF EXISTS "board_invites_delete" ON board_invites;
CREATE POLICY "board_invites_delete" ON board_invites FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM board_members
      WHERE board_members.board_id = board_invites.board_id
        AND board_members.user_id  = auth.uid()
    )
  );

-- 4. Tighten board_members INSERT so only public boards allow self-join.
--    (Owner self-insert during board creation is always allowed via role='owner'.)
--    Drop any existing self-join policy first, then recreate.
DROP POLICY IF EXISTS "board_members_insert_self"    ON board_members;
DROP POLICY IF EXISTS "Allow members to join boards" ON board_members;
DROP POLICY IF EXISTS "board_members_insert"         ON board_members;

CREATE POLICY "board_members_insert" ON board_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      -- always allowed to add yourself as owner (board creation)
      role = 'owner'
      OR
      -- only allowed to self-join as editor on public boards
      EXISTS (
        SELECT 1 FROM boards
        WHERE boards.id         = board_members.board_id
          AND boards.visibility = 'public'
      )
    )
  );

-- 5. Boards SELECT: all authenticated users can read board metadata
--    (needed so joinBoard can check visibility before they're a member).
--    Objects/connectors are still protected by their own policies.
DROP POLICY IF EXISTS "boards_select" ON boards;

CREATE POLICY "boards_select" ON boards FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);
