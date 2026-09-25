-- Instantanés immuables des documents PRO (CCTP, DPGF et estimatif partagent
-- le même arbre). Ils ne remplacent pas l'autosauvegarde courante.
CREATE TABLE IF NOT EXISTS dpgf_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  dpgf_id TEXT REFERENCES dpgfs(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  phase TEXT,
  version TEXT,
  document JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dpgf_versions_project ON dpgf_versions(tenant_id, project_id, created_at DESC);
ALTER TABLE dpgf_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON dpgf_versions;
CREATE POLICY "tenant_isolation" ON dpgf_versions USING (tenant_id = my_tenant_id());
