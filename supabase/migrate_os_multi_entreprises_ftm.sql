-- Ordres de service adressés à plusieurs entreprises, et onglet « Travaux modificatifs »
-- (devis reçus des entreprises pour des travaux supplémentaires, fiches de travaux
-- modificatifs FTM). Idempotent, purement additif : une instance non migrée garde
-- le comportement précédent (un OS = un marché).

-- Un OS peut viser plusieurs marchés (donc plusieurs entreprises). marche_id reste
-- le marché principal (premier de la liste) pour ne rien casser en lecture.
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS marche_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Fiches de travaux modificatifs (FTM), numérotées FTM-01, FTM-02... par affaire.
CREATE TABLE IF NOT EXISTS ftm (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  numero TEXT NOT NULL,
  title TEXT NOT NULL,
  objet TEXT,
  origine TEXT,
  motif TEXT,
  description TEXT,
  marche_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  incidence_delai_jours INTEGER,
  incidences_delais_details TEXT,
  montant_estime_ht NUMERIC,
  montant_accepte_ht NUMERIC,
  status TEXT NOT NULL DEFAULT 'brouillon',
  date_emission TEXT,
  date_decision TEXT,
  ordre_service_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ftm_tenant_project ON ftm(tenant_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS ftm_numero_unique ON ftm(tenant_id, project_id, numero);

-- Devis reçus des entreprises pour des travaux supplémentaires.
CREATE TABLE IF NOT EXISTS devis_travaux_modificatifs (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  marche_id TEXT,
  entreprise TEXT,
  reference TEXT,
  objet TEXT NOT NULL,
  montant_ht NUMERIC,
  date_reception TEXT,
  statut TEXT NOT NULL DEFAULT 'recu',
  ftm_id TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devis_tm_tenant_project ON devis_travaux_modificatifs(tenant_id, project_id);

ALTER TABLE ftm ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON ftm;
CREATE POLICY "tenant_isolation" ON ftm USING (tenant_id = my_tenant_id());
ALTER TABLE devis_travaux_modificatifs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON devis_travaux_modificatifs;
CREATE POLICY "tenant_isolation" ON devis_travaux_modificatifs USING (tenant_id = my_tenant_id());
