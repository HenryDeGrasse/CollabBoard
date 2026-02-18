-- Add optional per-object text styling fields.
-- Applies to sticky notes, shapes, and frame titles.

ALTER TABLE public.objects
  ADD COLUMN IF NOT EXISTS text_size INTEGER,
  ADD COLUMN IF NOT EXISTS text_color TEXT;

-- Keep values within sane UI bounds.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'objects_text_size_check'
  ) THEN
    ALTER TABLE public.objects
      ADD CONSTRAINT objects_text_size_check
      CHECK (text_size IS NULL OR (text_size >= 8 AND text_size <= 72));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'objects_text_color_check'
  ) THEN
    ALTER TABLE public.objects
      ADD CONSTRAINT objects_text_color_check
      CHECK (
        text_color IS NULL OR
        text_color ~ '^#[0-9A-Fa-f]{6}$'
      );
  END IF;
END $$;
