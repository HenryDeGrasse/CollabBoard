-- Migration: allow connectors with free-floating (non-object-pinned) endpoints.
--
-- Before this change every connector required both from_id and to_id to reference
-- an existing object.  Now either endpoint can be a free canvas point instead,
-- represented as a JSONB column { x, y }.  When from_id / to_id is NULL the
-- corresponding from_point / to_point column holds the coordinates.

-- 1. Drop the NOT NULL constraints so NULL means "free point"
ALTER TABLE connectors
  ALTER COLUMN from_id DROP NOT NULL,
  ALTER COLUMN to_id   DROP NOT NULL;

-- 2. Drop the existing FK constraints (they implicitly require non-NULL).
--    Re-add them as nullable FKs that still cascade on delete so that when an
--    object is deleted, connectors that referenced it are cleaned up.
ALTER TABLE connectors
  DROP CONSTRAINT IF EXISTS connectors_from_id_fkey,
  DROP CONSTRAINT IF EXISTS connectors_to_id_fkey;

ALTER TABLE connectors
  ADD CONSTRAINT connectors_from_id_fkey
    FOREIGN KEY (from_id) REFERENCES objects(id) ON DELETE CASCADE,
  ADD CONSTRAINT connectors_to_id_fkey
    FOREIGN KEY (to_id)   REFERENCES objects(id) ON DELETE CASCADE;

-- 3. Add JSONB columns for free-floating anchor coordinates.
ALTER TABLE connectors
  ADD COLUMN IF NOT EXISTS from_point JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS to_point   JSONB DEFAULT NULL;
