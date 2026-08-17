-- Add co-contractor (cotraitants) breakdown, the operation-wide fee rate,
-- and a multi-image gallery (with a designated primary image) to
-- custom_references, matching the fields already offered for projects.

ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS fee_rate NUMERIC;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS cotraitants JSONB DEFAULT '[]'::jsonb;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
