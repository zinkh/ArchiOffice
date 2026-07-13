-- ============================================================
-- MIGRATION : Flux d'activité (activities, feed_posts, feed_comments, feed_likes)
-- À exécuter dans le SQL Editor Supabase
-- Ces tables sont référencées par /api/feed depuis server.ts mais n'ont
-- jamais été créées en base — le flux paraissait donc se réinitialiser
-- à chaque connexion (rien n'était réellement persisté).
-- ============================================================

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  target TEXT,
  target_id TEXT,
  target_type TEXT,
  category TEXT,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_posts (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT,
  user_name TEXT,
  content TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_comments (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  post_id TEXT REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id TEXT,
  user_name TEXT,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_likes (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  user_id TEXT
);

CREATE INDEX IF NOT EXISTS activities_tenant_idx ON activities(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_posts_tenant_idx ON feed_posts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_comments_post_idx ON feed_comments(post_id);
CREATE INDEX IF NOT EXISTS feed_likes_lookup_idx ON feed_likes(tenant_id, user_id, item_type, item_id);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON activities;
CREATE POLICY tenant_isolation ON activities USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON feed_posts;
CREATE POLICY tenant_isolation ON feed_posts USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON feed_comments;
CREATE POLICY tenant_isolation ON feed_comments USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON feed_likes;
CREATE POLICY tenant_isolation ON feed_likes USING (tenant_id = my_tenant_id());

-- Utilisé par /api/feed et /api/notifications pour marquer le flux comme lu
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS notifications_last_seen TIMESTAMPTZ;
