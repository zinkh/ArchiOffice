-- Migration: Time tracking + leave (congés) management
-- Daily clock-in/clock-out entries, leave requests with a manager-approval
-- workflow, and per-employee/year leave balances. Leave-type defaults reflect
-- the Convention collective nationale des entreprises d'architecture (IDCC 2332,
-- consolidée 01/02/2020) — see src/pages/Leave.tsx for the reference tables
-- (RTT days by contractual weekly hours, congés exceptionnels by motif). Those
-- figures are admin-editable, not hardcoded, since a cabinet's own accord
-- d'entreprise / usages acquis can be more generous.

-- ─── Time tracking ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  entry_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  start_time TEXT NOT NULL,        -- ISO timestamp
  end_time TEXT,                   -- ISO timestamp; NULL while clocked in
  description TEXT,
  source TEXT NOT NULL DEFAULT 'clock', -- 'clock' | 'manual'
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_user_date ON time_entries(tenant_id, user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_project ON time_entries(tenant_id, project_id);
-- Enforce one open clock-in per user at the DB level (belt-and-suspenders with the app-level check)
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_open_per_user
  ON time_entries(tenant_id, user_id) WHERE end_time IS NULL;

-- ─── Leave requests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('conges_payes','rtt','maladie','sans_solde','exceptionnel')),
  motif TEXT, -- only meaningful when leave_type = 'exceptionnel' (naissance, mariage_salarie, mariage_enfant, journee_citoyen, paternite, deces_conjoint_enfant, deces_parent, deces_autre_famille)
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  business_days NUMERIC NOT NULL,  -- computed server-side at creation (weekday count)
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_user ON leave_requests(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant_status ON leave_requests(tenant_id, status);

-- ─── Leave balances (admin overrides; falls back to tenant defaults in `settings`) ──
CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('conges_payes','rtt')), -- only accruing types; maladie/sans_solde/exceptionnel never deduct
  allocated_days NUMERIC NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (tenant_id, user_id, year, leave_type)
);
CREATE INDEX IF NOT EXISTS idx_leave_balances_tenant_user_year ON leave_balances(tenant_id, user_id, year);

ALTER TABLE time_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON time_entries   USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON leave_requests USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON leave_balances USING (tenant_id = my_tenant_id());

-- ─── Tenant-wide default annual allocations (used when no leave_balances override exists) ──
-- Congés payés default of 25 reflects the commonly-used jours-ouvrés-equivalent figure for
-- the convention's 2.5 jours ouvrables/month (30 jours ouvrables/year) entitlement.
-- RTT has no flat legal default (it depends on contractual weekly hours), so it defaults to 0
-- and must be set per employee by an admin.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_leave_days_conges_payes NUMERIC DEFAULT 25;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_leave_days_rtt NUMERIC DEFAULT 0;
