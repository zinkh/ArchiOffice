-- Migration : journal des appels téléphoniques, attribués à un collaborateur
--
-- Un appel reçu ou passé au cabinet se saisit en quelques secondes (interlocuteur,
-- objet, notes), s'attribue à un collaborateur qui est prévenu par notification,
-- et peut devenir une tâche (task_id). Voir server/routes/phoneCalls.ts et
-- src/pages/PhoneCalls.tsx.
--
-- Hors SYNC_TABLES : la saisie hors ligne passe par la file d'écritures du client
-- (src/lib/sync.ts), pas par la réplication de la table.

CREATE TABLE IF NOT EXISTS phone_calls (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  direction TEXT NOT NULL DEFAULT 'entrant'
    CONSTRAINT phone_calls_direction_check CHECK (direction IN ('entrant', 'sortant')),
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_minutes INTEGER
    CONSTRAINT phone_calls_duration_check CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  caller_name TEXT,
  caller_company TEXT,
  caller_phone TEXT,
  caller_email TEXT,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  notes TEXT,
  -- TEXT sans FK, comme tasks.assignee_id et project_members.user_id.
  assignee_id TEXT,
  status TEXT NOT NULL DEFAULT 'a_traiter'
    CONSTRAINT phone_calls_status_check CHECK (status IN ('a_traiter', 'en_cours', 'traite')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CONSTRAINT phone_calls_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  callback_due DATE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_tenant_assignee ON phone_calls(tenant_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_phone_calls_tenant_status   ON phone_calls(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_phone_calls_tenant_called   ON phone_calls(tenant_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_calls_tenant_project  ON phone_calls(tenant_id, project_id);

ALTER TABLE phone_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON phone_calls;
CREATE POLICY "tenant_isolation" ON phone_calls
  USING (tenant_id = my_tenant_id());
