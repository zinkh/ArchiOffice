CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  lot_id TEXT REFERENCES project_lots(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  texte TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'À faire',
  due_date TEXT,
  created_report_id TEXT REFERENCES site_reports(id) ON DELETE SET NULL,
  resolved_report_id TEXT REFERENCES site_reports(id) ON DELETE SET NULL,
  number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON observations
  FOR ALL USING (tenant_id = my_tenant_id());

CREATE TABLE IF NOT EXISTS observation_reports (
  observation_id TEXT REFERENCES observations(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES site_reports(id) ON DELETE CASCADE,
  PRIMARY KEY (observation_id, report_id)
);

ALTER TABLE observation_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON observation_reports
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM observations o
      WHERE o.id = observation_id AND o.tenant_id = my_tenant_id()
    )
  );
