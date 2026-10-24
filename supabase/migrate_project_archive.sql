-- Migration : archivage des affaires
--
-- Une affaire terminée restait dans toutes les listes, alertes et suggestions.
-- Archiver est un geste distinct de « terminée » : l'affaire est rangée, en
-- lecture seule, avec une date de fin de conservation. Additif et rejouable :
-- aucune ligne existante ne change de sens (archived_at NULL = affaire active).
-- Voir server/routes/projectArchive.ts et src/lib/projectArchive.ts.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archive_reason TEXT;
-- Fin de la durée de conservation : archived_at + settings.archive_retention_years.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS retention_until DATE;

CREATE INDEX IF NOT EXISTS idx_projects_tenant_archived
  ON projects(tenant_id, archived_at);

-- Durée de conservation par cabinet, en années (NULL = 10 ans).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS archive_retention_years INTEGER
  CHECK (archive_retention_years IS NULL OR archive_retention_years BETWEEN 1 AND 50);

-- Journal : clôture, réouverture, motif de passage outre les contrôles.
CREATE TABLE IF NOT EXISTS project_archive_log (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'unarchive')),
  reason TEXT,
  -- Contrôles de clôture en alerte au moment du geste (jsonb : [{ id, label, detail }]).
  overridden_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_id UUID,
  user_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_archive_log_tenant_project
  ON project_archive_log(tenant_id, project_id, created_at DESC);

ALTER TABLE project_archive_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_archive_log;
CREATE POLICY "tenant_isolation" ON project_archive_log
  USING (tenant_id = my_tenant_id());
