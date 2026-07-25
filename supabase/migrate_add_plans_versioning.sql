-- The frontend Plan type/UI (indice A/B/C bump on re-upload, PRO vs AOR
-- plan grouping) has always assumed these columns exist, but they were
-- never added to the real table — POST /api/plans silently dropped them.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS index TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS category TEXT;
