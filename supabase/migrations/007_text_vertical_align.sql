-- Add text_vertical_align column to objects
-- Allows per-object vertical text alignment: top, middle, bottom
ALTER TABLE objects ADD COLUMN IF NOT EXISTS text_vertical_align text DEFAULT NULL;
