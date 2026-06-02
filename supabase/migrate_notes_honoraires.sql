-- Migration: Notes d'honoraires, cotraitants et sous-traitants dans les contrats MOE

-- Corriger le type de client_id dans contrats_moe si la colonne est uuid
-- (contacts.id est TEXT dans le schéma de référence)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contrats_moe'
      AND column_name = 'client_id'
      AND data_type = 'uuid'
  ) THEN
    -- Supprimer la contrainte FK existante
    ALTER TABLE contrats_moe DROP CONSTRAINT IF EXISTS contrats_moe_client_id_fkey;
    -- Convertir la colonne en text
    ALTER TABLE contrats_moe ALTER COLUMN client_id TYPE TEXT USING client_id::text;
    -- Recréer la contrainte FK avec le bon type
    ALTER TABLE contrats_moe
      ADD CONSTRAINT contrats_moe_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Ajouter les colonnes équipe MOE aux contrats
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

DROP POLICY IF EXISTS "tenant_isolation_notes_honoraires" ON notes_honoraires;
CREATE POLICY "tenant_isolation_notes_honoraires"
  ON notes_honoraires
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

-- Index
CREATE INDEX IF NOT EXISTS notes_honoraires_project_id_idx ON notes_honoraires(project_id);
CREATE INDEX IF NOT EXISTS notes_honoraires_tenant_id_idx ON notes_honoraires(tenant_id);
