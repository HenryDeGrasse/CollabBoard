-- ── board_members: enable realtime for immediate kick detection ──────────────
--
-- Without this, postgres_changes subscriptions on board_members never fire
-- because the table is not in the supabase_realtime publication.
-- The membership guard therefore relied solely on polling (3 s delay).
--
-- REPLICA IDENTITY FULL is required so that DELETE events carry the old row
-- data, which Supabase needs to evaluate the board_id filter on the channel
-- subscription before delivering the event to the right clients.

ALTER TABLE public.board_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.board_members;
