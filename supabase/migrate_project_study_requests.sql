-- Migration : historique des demandes envoyées depuis la fiche affaire
--
-- Un envoi (demande de devis au géotechnicien, consultation du contrôleur
-- technique, consultation du CSPS) est enregistré dans l'affaire au moment où le
-- composeur confirme l'envoi. Une seule table pour les trois natures, distinguées
-- par `kind`. Voir server/routes/projectStudyRequests.ts et
-- src/components/projectDetail/StudyRequestTab.tsx.
--
-- Hors SYNC_TABLES : l'envoi lui-même ne se fait pas hors ligne.

CREATE TABLE IF NOT EXISTS project_study_requests (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL
    CONSTRAINT project_study_requests_kind_check CHECK (kind IN ('geotechnique', 'controle_technique', 'csps')),
  subject TEXT NOT NULL,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  etudes TEXT[] NOT NULL DEFAULT '{}',
  -- Valeurs saisies dans le formulaire, telles qu'envoyées : l'historique reste
  -- lisible même si les données de l'affaire changent ensuite.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- TEXT sans FK, comme phone_calls.created_by.
  sent_by TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_study_requests_project ON project_study_requests(tenant_id, project_id, kind, sent_at DESC);

ALTER TABLE project_study_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_study_requests;
CREATE POLICY "tenant_isolation" ON project_study_requests
  USING (tenant_id = my_tenant_id());
