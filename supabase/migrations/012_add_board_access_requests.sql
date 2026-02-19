-- ============================================================
-- Migration: board access requests (private-board request flow)
-- ============================================================

CREATE TABLE IF NOT EXISTS board_access_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id     UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id)
);

-- One request row per (board, requester). Re-requests reuse the same row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_access_requests_unique
  ON board_access_requests(board_id, requester_id);

ALTER TABLE board_access_requests ENABLE ROW LEVEL SECURITY;

-- No client-side direct reads/writes; API routes use service role.
-- Keep table locked down by default (no policies).
