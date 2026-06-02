-- Migration: Notes d'honoraires, cotraitants et sous-traitants dans les contrats MOE

-- Ajouter les cotraitants et sous-traitants aux contrats MOE
ALTER TABLE contrats_moe ADD COLUMN IF NOT EXISTS cotraitants jsonb DEFAULT '[]';
ALTER TABLE contrats_moe ADD COLUMN IF NOT EXISTS sous_traitants jsonb DEFAULT '[]';

-- Table des notes d'honoraires
CREATE TABLE IF NOT EXISTS notes_honoraires (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  contrat_id uuid REFERENCES contrats_moe(id) ON DELETE SET NULL,
  numero text,
  date date,
  objet text,
  status text DEFAULT 'Brouillon',
  -- Ventilation par phase (JSON array: [{phase_id, phase_name, avancement_pct, montant_phase}])
  phases jsonb DEFAULT '[]',
  -- Montants agence
  montant_ht numeric(12,2) DEFAULT 0,
  tva_rate numeric(5,2) DEFAULT 20,
  montant_tva numeric(12,2) DEFAULT 0,
  montant_ttc numeric(12,2) DEFAULT 0,
  -- Cotraitants (hors comptabilité agence, sauf si mandataire)
  cotraitants_facturation jsonb DEFAULT '[]',
  -- Sous-traitants (dans comptabilité sauf paiement_direct_moa = true)
  sous_traitants_facturation jsonb DEFAULT '[]',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE notes_honoraires ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_notes_honoraires"
  ON notes_honoraires
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

-- Index
CREATE INDEX IF NOT EXISTS notes_honoraires_project_id_idx ON notes_honoraires(project_id);
CREATE INDEX IF NOT EXISTS notes_honoraires_tenant_id_idx ON notes_honoraires(tenant_id);
