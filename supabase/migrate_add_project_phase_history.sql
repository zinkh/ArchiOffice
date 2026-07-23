-- Migration: Suivi des phases de mission par projet (ESQ/APS/APD/PC/PRO/DCE/ACT/VISA/DET/AOR)
-- Alimente le référentiel interne du cabinet exposé aux agents IA (durées de phase réelles).

CREATE TABLE IF NOT EXISTS project_phase_history (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  phase TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  exited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_phase_history_tenant_project ON project_phase_history(tenant_id, project_id);

ALTER TABLE project_phase_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON project_phase_history
  USING (tenant_id = my_tenant_id());
