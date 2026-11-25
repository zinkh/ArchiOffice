-- Intervenants des entreprises d'un lot (onglet DET > Entreprises) : plusieurs personnes
-- par entreprise, chacune avec un rôle (conducteur de travaux, chef de chantier...). Idempotent.
CREATE TABLE IF NOT EXISTS lot_intervenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lot_id     TEXT NOT NULL REFERENCES project_lots(id) ON DELETE CASCADE,
  entreprise TEXT NOT NULL,
  nom        TEXT NOT NULL,
  role       TEXT,
  telephone  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lot_intervenants_project ON lot_intervenants(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS lot_intervenants_lot ON lot_intervenants(lot_id);

ALTER TABLE lot_intervenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON lot_intervenants;
CREATE POLICY "tenant_isolation" ON lot_intervenants
  USING (tenant_id = my_tenant_id());
