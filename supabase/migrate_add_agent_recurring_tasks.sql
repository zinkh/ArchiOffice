-- Tâches récurrentes pour les agents
--
-- Permet de configurer des tâches automatiques pour les agents
-- (ex: relances, vérifications, rapports)

CREATE TABLE IF NOT EXISTS agent_recurring_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('query', 'reminder', 'report')),
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  hour_utc INTEGER NOT NULL DEFAULT 9 CHECK (hour_utc BETWEEN 0 AND 23),
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 28),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_recurring_tasks_tenant ON agent_recurring_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_recurring_tasks_agent ON agent_recurring_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_recurring_tasks_next_run ON agent_recurring_tasks(next_run_at);

ALTER TABLE agent_recurring_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_recurring_tasks;
CREATE POLICY "tenant_isolation" ON agent_recurring_tasks
  USING (tenant_id = my_tenant_id());

-- Historique des exécutions
CREATE TABLE IF NOT EXISTS agent_recurring_task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_recurring_tasks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  result TEXT,
  error TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost_eur_cents INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_recurring_task_runs_task ON agent_recurring_task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_recurring_task_runs_tenant ON agent_recurring_task_runs(tenant_id);

ALTER TABLE agent_recurring_task_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_recurring_task_runs;
CREATE POLICY "tenant_isolation" ON agent_recurring_task_runs
  USING (tenant_id = my_tenant_id());
