-- ============================================================
-- MIGRATION : Auto-archivage des notifications / flux d'activité
-- À exécuter dans le SQL Editor Supabase
-- Ajoute une colonne archived_at (activities, feed_posts) plus un réglage
-- global par cabinet définissant, pour chaque catégorie d'activité, au bout
-- de combien de jours un élément est archivé automatiquement
-- (server/notificationArchiver.ts). 0 ou absent = jamais archivé.
-- ============================================================

ALTER TABLE activities ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Remplace les index existants sur (tenant_id, created_at) : le flux actif
-- filtre désormais aussi sur archived_at IS NULL, et l'archiveur filtre par
-- catégorie + ancienneté.
CREATE INDEX IF NOT EXISTS activities_tenant_archived_idx ON activities(tenant_id, archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_posts_tenant_archived_idx ON feed_posts(tenant_id, archived_at, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_category_archive_idx ON activities(tenant_id, category, archived_at);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS notification_archive_days JSONB DEFAULT '{}'::jsonb;
