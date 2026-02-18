-- Fix: DELETE events not reaching collaborators via Realtime.
--
-- By default, PostgreSQL only includes primary-key columns in the OLD record
-- for DELETE WAL events (REPLICA IDENTITY DEFAULT).  Our Realtime channel
-- filters on `board_id=eq.{boardId}`, but `board_id` isn't the PK — so the
-- Supabase Realtime server can never match the filter, and DELETE events are
-- silently dropped for every subscriber.
--
-- Setting REPLICA IDENTITY FULL ensures all columns appear in the OLD record,
-- letting the board_id filter work for INSERT, UPDATE, *and* DELETE events.

ALTER TABLE public.objects REPLICA IDENTITY FULL;
ALTER TABLE public.connectors REPLICA IDENTITY FULL;
