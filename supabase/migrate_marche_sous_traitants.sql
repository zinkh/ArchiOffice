-- Sous-traitants des entreprises titulaires d'un marché de travaux (onglet RDT).
-- Ils ne figurent pas sur le panneau de chantier mais dans la liste publique des
-- entreprises atteinte par le QR code du panneau. Idempotent.
CREATE TABLE IF NOT EXISTS marche_sous_traitants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  marche_id  UUID NOT NULL REFERENCES marches_entreprises(id) ON DELETE CASCADE,
  nom        TEXT NOT NULL,
  siret      TEXT,
  adresse    TEXT,
  objet      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marche_sous_traitants_project ON marche_sous_traitants(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS marche_sous_traitants_marche ON marche_sous_traitants(marche_id);

ALTER TABLE marche_sous_traitants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON marche_sous_traitants;
CREATE POLICY "tenant_isolation" ON marche_sous_traitants
  USING (tenant_id = my_tenant_id());
