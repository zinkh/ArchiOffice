-- Migration : « Base de données » du cabinet (mini-Notion)
--
-- Pages imbriquées à contenu riche (Tiptap), bases de données à propriétés typées (tableau Fabricants,
-- Détails constructifs...) et vues enregistrées (filtre, tri, colonnes). Comme dans Notion, TOUT est une
-- page : une ligne de base de données est une page dont le parent est la base, et ses valeurs de
-- colonnes sont dans `properties` (clé = id de propriété).
-- Voir server/routes/knowledgeBase.ts et src/pages/BaseDeDonnees.tsx. Hors SYNC_TABLES (comme
-- document_folders). Les pièces jointes passent par documents.resource_type = 'kb_pages'.

CREATE TABLE IF NOT EXISTS kb_pages (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'database')),
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  icon TEXT,
  content JSONB,
  content_text TEXT NOT NULL DEFAULT '',
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trashed_at TIMESTAMPTZ,
  UNIQUE (id, tenant_id)
);

-- Un parent est toujours une page du même cabinet (clé composite). Supprimer un parent supprime ses enfants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_pages_parent_tenant_fkey') THEN
    ALTER TABLE kb_pages
      ADD CONSTRAINT kb_pages_parent_tenant_fkey
      FOREIGN KEY (parent_id, tenant_id) REFERENCES kb_pages (id, tenant_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kb_pages_tree ON kb_pages (tenant_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_kb_pages_project ON kb_pages (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_pages_search ON kb_pages
  USING gin (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content_text, '')));

-- Propriétés (colonnes) d'une base de données.
CREATE TABLE IF NOT EXISTS kb_properties (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK (type IN ('title', 'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'relation')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  width INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (database_id, tenant_id) REFERENCES kb_pages (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_properties_database ON kb_properties (tenant_id, database_id, position);

-- Vues enregistrées d'une base (tableau en V1) : filtres, tris, colonnes visibles et leur ordre.
CREATE TABLE IF NOT EXISTS kb_views (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Tableau' CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  type TEXT NOT NULL DEFAULT 'table' CHECK (type IN ('table')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (database_id, tenant_id) REFERENCES kb_pages (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_views_database ON kb_views (tenant_id, database_id, position);

ALTER TABLE kb_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON kb_pages;
CREATE POLICY "tenant_isolation" ON kb_pages USING (tenant_id = my_tenant_id());

ALTER TABLE kb_properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON kb_properties;
CREATE POLICY "tenant_isolation" ON kb_properties USING (tenant_id = my_tenant_id());

ALTER TABLE kb_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON kb_views;
CREATE POLICY "tenant_isolation" ON kb_views USING (tenant_id = my_tenant_id());
