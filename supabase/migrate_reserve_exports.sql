-- Migration : journal des exports et diffusions de réserves (OPR et GPA)
--
-- Chaque export (téléchargement) ou diffusion (envoi par e-mail aux intervenants et aux
-- entreprises) de la liste des réserves est consigné : périmètre choisi (toute la liste ou
-- certains lots), canal, état et date, et le détail des envois pour le suivi
-- (destinataire, adresse, nombre de réserves, état, date, erreur éventuelle).
-- Voir server/routes/reserveExports.ts et src/components/pro/ReserveDiffusionDialog.tsx.
--
-- L'état d'une diffusion se déduit de ses envois (statutDiffusion, src/lib/reserveDiffusion.ts).
-- Hors SYNC_TABLES : c'est un journal serveur, sans saisie hors ligne.

CREATE TABLE IF NOT EXISTS reserve_exports (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL
    CONSTRAINT reserve_exports_kind_check CHECK (kind IN ('opr', 'gpa')),
  scope TEXT NOT NULL DEFAULT 'all'
    CONSTRAINT reserve_exports_scope_check CHECK (scope IN ('all', 'lots')),
  -- Intitulés des lots du périmètre quand scope = 'lots'.
  lots JSONB NOT NULL DEFAULT '[]'::jsonb,
  reserve_count INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL
    CONSTRAINT reserve_exports_channel_check CHECK (channel IN ('telechargement', 'mail')),
  status TEXT NOT NULL DEFAULT 'exporte'
    CONSTRAINT reserve_exports_status_check CHECK (status IN ('exporte', 'en_cours', 'envoye', 'partiel', 'echec')),
  -- Un élément par destinataire : { key, role, name, email, reserve_count, status, sent_at, error? }.
  sends JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  created_by TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reserve_exports_project ON reserve_exports(tenant_id, project_id, created_at DESC);

ALTER TABLE reserve_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON reserve_exports;
CREATE POLICY "tenant_isolation" ON reserve_exports
  USING (tenant_id = my_tenant_id());

-- ── Rappels hebdomadaires automatiques des réserves non levées ───────────────
-- Un réglage par opération et par type de réserves (OPR ou GPA) : actif ou non, tous les
-- `interval_days` jours (7 par défaut). Chaque rappel envoyé est aussi consigné dans le journal
-- ci-dessus, avec le canal « relance ». Voir server/reserveReminders.ts.
ALTER TABLE reserve_exports DROP CONSTRAINT IF EXISTS reserve_exports_channel_check;
ALTER TABLE reserve_exports ADD CONSTRAINT reserve_exports_channel_check
  CHECK (channel IN ('telechargement', 'mail', 'relance'));

CREATE TABLE IF NOT EXISTS reserve_reminder_settings (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL
    CONSTRAINT reserve_reminder_settings_kind_check CHECK (kind IN ('opr', 'gpa')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_days INTEGER NOT NULL DEFAULT 7
    CONSTRAINT reserve_reminder_settings_interval_check CHECK (interval_days BETWEEN 1 AND 60),
  last_run_at TIMESTAMPTZ,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reserve_reminder_settings_unique UNIQUE (project_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_reserve_reminder_settings_due ON reserve_reminder_settings(enabled, last_run_at);

ALTER TABLE reserve_reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON reserve_reminder_settings;
CREATE POLICY "tenant_isolation" ON reserve_reminder_settings
  USING (tenant_id = my_tenant_id());
