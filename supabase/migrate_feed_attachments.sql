-- ============================================================
-- MIGRATION : Pièces jointes sur les posts / commentaires du flux d'activité
-- À exécuter dans le SQL Editor Supabase
-- ============================================================

ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS attachment_type TEXT;

ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS attachment_type TEXT;
