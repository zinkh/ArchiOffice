-- Module États d'acompte complet (MAF REF20A/20B)

-- Marché par lot/entreprise (lien entre projet et une entreprise/lot)
CREATE TABLE IF NOT EXISTS marches_entreprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  lot_numero TEXT DEFAULT '',
  lot_titre TEXT DEFAULT '',
  montant_ht NUMERIC(15,2) DEFAULT 0,
  tva_rate NUMERIC(5,2) DEFAULT 20,
  date_os DATE,
  duree_mois INTEGER,
  -- Avance (art. 20.2 NF P 03-001 / CCAG)
  avance_pct NUMERIC(5,2) DEFAULT 5,
  avance_montant_ttc NUMERIC(15,2) DEFAULT 0,
  avance_remboursee_cumul NUMERIC(15,2) DEFAULT 0,
  -- Retenue de garantie (loi 71-584)
  retenue_garantie_pct NUMERIC(5,2) DEFAULT 5,
  retenue_garantie_bancaire BOOLEAN DEFAULT FALSE,
  retenue_garantie_bancaire_montant NUMERIC(15,2) DEFAULT 0,
  -- Révision des prix (indices BT/TP INSEE)
  -- formule: Cn = fixe + Σ(poids_i × I_n_i / I_0_i)
  -- fixe + Σpoids_i = 1  (fixe ≥ 0.125 en marchés publics)
  revision_active BOOLEAN DEFAULT FALSE,
  revision_formule JSONB DEFAULT '{"fixe": 0.15, "indices": []}',
  -- indices: [{code: "BT01", label: "Bâtiment général", poids: 0.85, periode_base: "2024-01", valeur_base: 100.5}]
  notes TEXT,
  statut TEXT DEFAULT 'en_cours', -- 'en_cours'|'termine'|'resilie'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE marches_entreprises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON marches_entreprises;
CREATE POLICY "tenant_isolation" ON marches_entreprises
  USING (tenant_id = my_tenant_id());

CREATE INDEX IF NOT EXISTS marches_entreprises_project
  ON marches_entreprises(tenant_id, project_id);

-- Extension de la table situations (état d'acompte mensuel)
ALTER TABLE situations
  ADD COLUMN IF NOT EXISTS marche_id UUID REFERENCES marches_entreprises(id),
  ADD COLUMN IF NOT EXISTS date_reception_situation DATE,
  ADD COLUMN IF NOT EXISTS penalites_ht NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalites_notes TEXT,
  ADD COLUMN IF NOT EXISTS avance_remboursement NUMERIC(15,2) DEFAULT 0,
  -- Révision : coefficient calculé (provisoire ou définitif)
  -- Cn = fixe + Σ(poids_i × val_courante_i / val_base_i)
  ADD COLUMN IF NOT EXISTS revision_coeff NUMERIC(10,6) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS revision_indices JSONB DEFAULT '[]',
  -- [{code, valeur_courante, provisoire: true}]
  ADD COLUMN IF NOT EXISTS notes_moe TEXT;

-- Extension de detail_situations (projet de décompte mensuel 20A)
ALTER TABLE detail_situations
  ADD COLUMN IF NOT EXISTS avancement_n_moins_1 NUMERIC(5,4) DEFAULT 0,
  -- pourcentage_avancement = avancement N (cumulé)
  -- avancement_n_moins_1  = avancement N-1 (cumulé précédent, auto-rempli)
  ADD COLUMN IF NOT EXISTS montant_cumul_n NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS montant_cumul_n_moins_1 NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS montant_periode NUMERIC(15,2);
  -- montant_periode = montant_cumul_n - montant_cumul_n_moins_1
  -- montant_situation conservé pour compatibilité (= montant_periode)
