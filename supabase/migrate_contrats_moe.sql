-- Migration: Contrats MOE
CREATE TABLE IF NOT EXISTS contrats_moe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero TEXT,
  type_contrat TEXT NOT NULL DEFAULT 'construction_neuve',
  type_moa TEXT NOT NULL DEFAULT 'prive',
  status TEXT NOT NULL DEFAULT 'Brouillon',

  -- Parties
  client_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

  -- Projet
  intitule_projet TEXT,
  adresse_travaux TEXT,
  surface_plancher NUMERIC,
  budget_previsionnel NUMERIC,

  -- Honoraires
  mode_honoraires TEXT NOT NULL DEFAULT 'forfait',
  montant_honoraires NUMERIC,
  taux_honoraires NUMERIC,
  indice_revision TEXT DEFAULT 'BT01',
  date_debut DATE,
  date_fin DATE,

  -- Missions (JSON array of {id, name, pct, incluse})
  missions_list JSONB DEFAULT '[]',

  -- Clauses
  delai_execution INTEGER,
  penalites_retard NUMERIC,
  clause_resiliation TEXT,
  clause_propriete_intellectuelle BOOLEAN DEFAULT TRUE,
  clause_mediation BOOLEAN DEFAULT TRUE,

  -- Assurance
  assureur TEXT,
  numero_police TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contrats_moe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON contrats_moe USING (tenant_id = my_tenant_id());
