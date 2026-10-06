-- Migration : notices d'études et notices réglementaires d'une opération.
--
-- Une notice est identifiée par l'affaire, son type et sa phase. Les notices
-- architecturales sont ainsi conservées séparément en ESQ / APS / APD / PC /
-- PRO / DCE au lieu d'écraser le texte de la phase précédente. Les notices
-- accessibilité et sécurité sont initialement portées par la phase PC.
-- Voir server/routes/projectNotices.ts et
-- src/components/projectDetail/ProjectNoticesTab.tsx.

CREATE TABLE IF NOT EXISTS project_notices (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('architectural', 'accessibility', 'security')),
  phase TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'a_rediger'
    CHECK (status IN ('a_rediger', 'redige')),
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, kind, phase)
);

CREATE INDEX IF NOT EXISTS idx_project_notices_tenant_project
  ON project_notices(tenant_id, project_id, kind, phase);

ALTER TABLE project_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_notices;
CREATE POLICY "tenant_isolation" ON project_notices
  USING (tenant_id = my_tenant_id());
