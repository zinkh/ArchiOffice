-- Migration : rapports de diagnostic d'une opération de rénovation (onglet DIAG).
--
-- Une affaire peut porter plusieurs rapports (structure, thermique, amiante,
-- humidité...). Le contenu est du HTML nettoyé côté serveur
-- (server/richHtml.ts) produit par l'éditeur de texte riche
-- (src/components/RichTextEditor.tsx).
-- Voir server/routes/diagReports.ts et src/components/projectDetail/DiagTab.tsx.

CREATE TABLE IF NOT EXISTS diag_reports (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Diagnostic',
  content TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diag_reports_tenant_project
  ON diag_reports(tenant_id, project_id, created_at);

ALTER TABLE diag_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON diag_reports;
CREATE POLICY "tenant_isolation" ON diag_reports
  USING (tenant_id = my_tenant_id());

-- Table utilisée uniquement par les routes serveur (supabaseAdmin).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.diag_reports TO service_role';
  END IF;
END
$$;
