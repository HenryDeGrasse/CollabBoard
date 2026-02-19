-- Add color and stroke_width to connectors so users can customise appearance.
ALTER TABLE connectors
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stroke_width REAL DEFAULT NULL;
