-- ============================================================
-- MIGRATION : Mentions (@Nom) dans le flux d'activité
-- À exécuter dans le SQL Editor Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  mentioned_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  author_id TEXT,
  author_name TEXT,
  item_type TEXT NOT NULL, -- 'post' | 'comment'
  item_id TEXT NOT NULL,
  post_id TEXT, -- parent post id, for comments (lets the UI jump back to the right feed item)
  content_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mentions_user_idx ON mentions(tenant_id, mentioned_user_id, created_at DESC);

ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON mentions;
CREATE POLICY tenant_isolation ON mentions USING (tenant_id = my_tenant_id());
