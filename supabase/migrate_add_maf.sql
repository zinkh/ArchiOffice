-- Migration : Plugin Déclaration MAF
-- Ajoute les champs MAF sur projects (stables), config tenant, et table annuelle

-- ── 1. Champs MAF sur projects (stables, propres au projet) ────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS doc_date DATE,
  ADD COLUMN IF NOT EXISTS date_fin_reelle DATE,
  ADD COLUMN IF NOT EXISTS date_depot_pc DATE,
  ADD COLUMN IF NOT EXISTS num_permis_construire TEXT,
  ADD COLUMN IF NOT EXISTS sismicite TEXT,
  ADD COLUMN IF NOT EXISTS retrait_argiles TEXT,
  ADD COLUMN IF NOT EXISTS bet_structure BOOLEAN,
  ADD COLUMN IF NOT EXISTS etude_sol BOOLEAN,
  ADD COLUMN IF NOT EXISTS mission_bim BOOLEAN,
  ADD COLUMN IF NOT EXISTS type_moa TEXT,
  ADD COLUMN IF NOT EXISTS nature_travaux_maf TEXT,
  ADD COLUMN IF NOT EXISTS taux_mission NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS part_interet NUMERIC(5,2);

-- ── 2. Config plugin MAF par tenant ────────────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS maf_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maf_numero_adherent TEXT,
  ADD COLUMN IF NOT EXISTS maf_taux_contrat_permil NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS maf_declaration_year INTEGER DEFAULT 2025;

-- ── 3. Données annuelles de déclaration ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maf_project_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  declaration_year INTEGER NOT NULL DEFAULT 2025,

  intercalaire TEXT NOT NULL DEFAULT 'jaune',

  -- Financier annuel (jaune / vert / ami / grand_chantier)
  montant_cumul_fin_annee NUMERIC(15,2),
  montant_cumul_annee_precedente NUMERIC(15,2),

  -- Honoraires (violet / orange_clair / orange_fonce / bleu)
  honoraires_ht NUMERIC(15,2),

  -- Cas particuliers
  puc_assureur TEXT,
  convention_speciale TEXT,
  accord_garantie_maf BOOLEAN DEFAULT FALSE,
  cotisation_provisionnelle NUMERIC(15,2),

  -- Snapshot taux au moment de la déclaration
  taux_cotisation_permil NUMERIC(8,4),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, project_id, declaration_year, intercalaire)
);

ALTER TABLE maf_project_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON maf_project_data;
CREATE POLICY "tenant_isolation" ON maf_project_data
  USING (tenant_id = my_tenant_id());

CREATE INDEX IF NOT EXISTS maf_project_data_tenant_year
  ON maf_project_data(tenant_id, declaration_year);
