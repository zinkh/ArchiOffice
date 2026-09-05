-- ── BPU / DQE et bibliothèque de prix du cabinet ─────────────────────────────
-- Le BPU (Bordereau de Prix Unitaires) est la pièce de prix des marchés à prix
-- unitaires et à bons de commande, là où le DPGF décompose un forfait. Le DQE
-- n'a pas de table : c'est le même document affiché avec les quantités.
--
-- La forme suivie est celle d'act_data (schema.sql:514-523) — du JSONB réel et
-- un updated_at — et non celle de dpgfs, qui stocke son document dans un
-- `data TEXT` sans index ni contrainte d'unicité alors que
-- server/routes/dpgf.ts:26 lit dessus avec .single().

CREATE TABLE IF NOT EXISTS bpu_data (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id  TEXT NOT NULL,
  -- Le document (en-tête de marché, tranches, arbre des articles).
  document    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Les offres reçues des entreprises, dans une colonne SÉPARÉE et derrière
  -- des endpoints séparés. L'autosauvegarde débouncée de l'éditeur réécrit le
  -- document entier : une offre logée dans le même blob serait effacée par la
  -- première sauvegarde suivant son import.
  offres      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- L'unicité que dpgfs n'a jamais eue, alors que sa route lit avec .single().
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bpu_data_tenant_project ON bpu_data(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_bpu_data_tenant_id ON bpu_data(tenant_id);

ALTER TABLE bpu_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON bpu_data;
CREATE POLICY "tenant_isolation" ON bpu_data
  FOR ALL USING (tenant_id = my_tenant_id());

-- ── Bibliothèque de prix du cabinet ──────────────────────────────────────────
-- articles_type existe depuis l'origine (schema.sql:544-548) mais n'a jamais
-- servi : elle ne porte que designation/unite/prix_unitaire/categorie, sans
-- code d'article, sans corps d'état exploitable et sans date — impossible d'y
-- juger la fraîcheur d'un prix. Sa RLS et sa politique tenant_isolation sont
-- déjà en place (schema.sql:631 et :724), il n'y a que des colonnes à ajouter.
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS lot_type TEXT;      -- corps d'état
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS description TEXT;   -- amorce aussi le CCTP
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS source TEXT;        -- 'projet:<id>', 'saisie', 'import'
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS date_prix DATE;
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0;
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS favori BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS notes TEXT;

-- La table n'avait aucun index : la recherche de la bibliothèque balayerait
-- toute la table à chaque frappe.
CREATE INDEX IF NOT EXISTS idx_articles_type_tenant_id ON articles_type(tenant_id);
CREATE INDEX IF NOT EXISTS idx_articles_type_categorie ON articles_type(tenant_id, categorie);
CREATE INDEX IF NOT EXISTS idx_articles_type_lot_type ON articles_type(tenant_id, lot_type);

-- ── Synchronisation cloud <-> local ──────────────────────────────────────────
-- Reprend ce que fait la boucle de migrate_add_sync_infra.sql pour les tables
-- existantes. server/syncTables.ts doit lister 'bpu_data' en regard, et le
-- littéral ARRAY[...] de cette migration aussi (son en-tête impose que les
-- deux restent synchrones).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_touch_updated_at ON bpu_data';
    EXECUTE 'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON bpu_data '
         || 'FOR EACH ROW EXECUTE FUNCTION touch_updated_at()';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'log_sync_change') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_log_sync_change ON bpu_data';
    EXECUTE 'CREATE TRIGGER trg_log_sync_change AFTER INSERT OR UPDATE OR DELETE ON bpu_data '
         || 'FOR EACH ROW EXECUTE FUNCTION log_sync_change()';
  END IF;
END;
$$;
