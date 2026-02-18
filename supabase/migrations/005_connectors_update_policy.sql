-- Allow board members to update connectors (needed for upsert in undo/restore).
CREATE POLICY "Members can update connectors"
  ON connectors FOR UPDATE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );
