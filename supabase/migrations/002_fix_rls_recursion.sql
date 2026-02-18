-- Fix infinite recursion in RLS policies for board_members
-- Problem: board_members SELECT policy queried board_members itself,
-- and boards/objects/connectors policies queried board_members which
-- triggered the recursive board_members SELECT policy.
--
-- Fix: board_members SELECT uses direct column check (user_id = auth.uid())
-- instead of a subquery on itself. Other tables can safely subquery
-- board_members since its policy no longer recurses.

-- ─── Drop recursive policies ──────────────────────────────────
DROP POLICY IF EXISTS "Members can see members" ON board_members;
DROP POLICY IF EXISTS "Members can read boards" ON boards;
DROP POLICY IF EXISTS "Members can read objects" ON objects;
DROP POLICY IF EXISTS "Members can create objects" ON objects;
DROP POLICY IF EXISTS "Members can update objects" ON objects;
DROP POLICY IF EXISTS "Members can delete objects" ON objects;
DROP POLICY IF EXISTS "Members can read connectors" ON connectors;
DROP POLICY IF EXISTS "Members can create connectors" ON connectors;
DROP POLICY IF EXISTS "Members can delete connectors" ON connectors;
DROP POLICY IF EXISTS "Members can read AI runs" ON ai_runs;

-- ─── board_members: direct user_id check (no self-reference) ──
-- A user can see their own memberships directly.
CREATE POLICY "Members can see own memberships"
  ON board_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── boards: subquery board_members (safe now) ────────────────
CREATE POLICY "Members can read boards"
  ON boards FOR SELECT TO authenticated
  USING (
    id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── objects: subquery board_members (safe now) ───────────────
CREATE POLICY "Members can read objects"
  ON objects FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create objects"
  ON objects FOR INSERT TO authenticated
  WITH CHECK (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can update objects"
  ON objects FOR UPDATE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete objects"
  ON objects FOR DELETE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── connectors: subquery board_members (safe now) ────────────
CREATE POLICY "Members can read connectors"
  ON connectors FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create connectors"
  ON connectors FOR INSERT TO authenticated
  WITH CHECK (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete connectors"
  ON connectors FOR DELETE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── ai_runs: subquery board_members (safe now) ──────────────
CREATE POLICY "Members can read AI runs"
  ON ai_runs FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );
