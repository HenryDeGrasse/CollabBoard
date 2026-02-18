-- ─── Board Versioning ────────────────────────────────────────
-- Monotonic counter incremented on each committed mutation batch.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Helper: atomically increment board version and return the new value.
CREATE OR REPLACE FUNCTION increment_board_version(p_board_id UUID)
RETURNS INTEGER AS $$
DECLARE
  new_version INTEGER;
BEGIN
  UPDATE boards
    SET version = version + 1,
        updated_at = now()
    WHERE id = p_board_id
    RETURNING version INTO new_version;
  RETURN new_version;
END;
$$ LANGUAGE plpgsql;

-- ─── Idempotent client_id on objects ────────────────────────
-- AI-generated objects carry a stable client_id so retries don't duplicate.
ALTER TABLE objects ADD COLUMN IF NOT EXISTS client_id UUID DEFAULT NULL;

-- Unique constraint: same board + client_id can't appear twice.
-- NULL client_ids are exempt (normal user-created objects).
CREATE UNIQUE INDEX IF NOT EXISTS idx_objects_board_client_id
  ON objects (board_id, client_id)
  WHERE client_id IS NOT NULL;

-- ─── Resumable AI jobs ──────────────────────────────────────
-- Extend ai_runs with step cursor and version tracking.
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS total_steps INTEGER DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS board_version_start INTEGER DEFAULT NULL;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS board_version_end INTEGER DEFAULT NULL;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS plan_json JSONB DEFAULT NULL;

-- Allow 'resuming' as a valid status.
ALTER TABLE ai_runs DROP CONSTRAINT IF EXISTS ai_runs_status_check;
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_status_check
  CHECK (status IN ('started', 'planning', 'executing', 'completed', 'failed', 'resuming', 'needs_confirmation'));
