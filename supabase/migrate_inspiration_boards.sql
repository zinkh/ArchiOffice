-- Bibliothèque d'inspirations et planches projet.
-- Les images restent des ressources du projet et peuvent être placées sur
-- plusieurs planches sans dupliquer les fichiers.
CREATE TABLE IF NOT EXISTS inspiration_boards (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL DEFAULT 'ESQ',
  format TEXT NOT NULL DEFAULT 'A3L',
  layout TEXT NOT NULL DEFAULT 'grid',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspiration_boards_tenant_project
  ON inspiration_boards(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_boards_project
  ON inspiration_boards(project_id);

CREATE TABLE IF NOT EXISTS inspiration_items (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  title TEXT,
  caption TEXT,
  phase TEXT NOT NULL DEFAULT 'ESQ',
  category TEXT NOT NULL DEFAULT 'architecture',
  file_url TEXT,
  source_url TEXT,
  storage_backend TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_item_has_source CHECK (file_url IS NOT NULL OR source_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_inspiration_items_tenant_project
  ON inspiration_items(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_items_tenant_phase
  ON inspiration_items(tenant_id, project_id, phase);
CREATE INDEX IF NOT EXISTS idx_inspiration_items_project
  ON inspiration_items(project_id);

CREATE TABLE IF NOT EXISTS inspiration_board_items (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  board_id TEXT REFERENCES inspiration_boards(id) ON DELETE CASCADE NOT NULL,
  item_id TEXT REFERENCES inspiration_items(id) ON DELETE CASCADE NOT NULL,
  position_x NUMERIC,
  position_y NUMERIC,
  width NUMERIC,
  height NUMERIC,
  rotation NUMERIC NOT NULL DEFAULT 0,
  z_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inspiration_board_items_tenant_project
  ON inspiration_board_items(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_board_items_board
  ON inspiration_board_items(board_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_board_items_project
  ON inspiration_board_items(project_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_board_items_item
  ON inspiration_board_items(item_id);

ALTER TABLE inspiration_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspiration_board_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON inspiration_boards;
CREATE POLICY tenant_isolation ON inspiration_boards
  USING (tenant_id = my_tenant_id())
  WITH CHECK (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON inspiration_items;
CREATE POLICY tenant_isolation ON inspiration_items
  USING (tenant_id = my_tenant_id())
  WITH CHECK (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON inspiration_board_items;
CREATE POLICY tenant_isolation ON inspiration_board_items
  USING (tenant_id = my_tenant_id())
  WITH CHECK (tenant_id = my_tenant_id());

-- Les installations cloud-link disposent déjà de ces fonctions. Les gardes
-- rendent la migration compatible avec une base initialisée sans ce module.
DO $$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('touch_updated_at()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['inspiration_boards', 'inspiration_items', 'inspiration_board_items']
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
        t
      );
    END LOOP;
  END IF;

  IF to_regprocedure('log_sync_change()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['inspiration_boards', 'inspiration_items', 'inspiration_board_items']
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_log_sync_change ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_log_sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_sync_change()',
        t
      );
    END LOOP;
  END IF;
END;
$$;
