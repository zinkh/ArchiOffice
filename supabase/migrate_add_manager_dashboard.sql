-- Migration: Manager assignment + responsible-user dashboard data
-- Adds a manager/direct-report hierarchy on profiles, plus permits, RFIs and
-- GPA reserve tracking (kept separate from the existing OPR `reserves` table).

-- ─── Manager hierarchy ──────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_manager_id ON profiles(manager_id);

-- ─── Permits (PC / DP / AT) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permits (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PC', 'DP', 'AT')),
  reference TEXT,
  submission_date TEXT,
  decision_date TEXT,
  status TEXT DEFAULT 'en_instruction',
  notes TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_permits_tenant_project ON permits(tenant_id, project_id);

-- ─── RFIs (demandes d'information) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS rfis (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  question TEXT NOT NULL,
  asked_by TEXT,
  asked_date TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'en_attente',
  answer TEXT,
  answered_date TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rfis_tenant_project ON rfis(tenant_id, project_id);

-- ─── GPA reserves (Garantie de Parfait Achèvement) ──────────────────
-- Deliberately a separate table from `reserves` (OPR) — same shape/mechanism,
-- distinct data set per project.
CREATE TABLE IF NOT EXISTS gpa_reserves (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, reception_id TEXT, title TEXT NOT NULL,
  batiment TEXT, local TEXT, status TEXT DEFAULT 'A faire',
  lots TEXT, entreprises TEXT, created_at TEXT, due_date TEXT,
  plan_id TEXT, x NUMERIC, y NUMERIC, number INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gpa_reserves_tenant_project ON gpa_reserves(tenant_id, project_id);

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE permits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpa_reserves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON permits
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON rfis
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON gpa_reserves
  USING (tenant_id = my_tenant_id());
