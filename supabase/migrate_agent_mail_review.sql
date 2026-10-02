-- ============================================================
-- ArchiOffice — Migration : revue matinale des mails par un agent
-- ============================================================
-- Chaque matin, l'agent désigné (Sophie) relit la boîte de la personne,
-- repère les mails qui attendent une réponse et lui envoie une notification
-- push par mail, avec une proposition de réponse (server/agentMailReview.ts).
--
-- Une boîte mail est personnelle : la revue est donc un réglage PAR PERSONNE
-- (une ligne par couple cabinet x personne), jamais par cabinet.

-- 1. Une ligne par personne et par cabinet. Désactivée tant que la personne
-- ne l'a pas activée elle-même.
CREATE TABLE IF NOT EXISTS agent_mail_reviews (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Heure LOCALE de la revue (0-23) dans `timezone` : « 8 h » doit rester
  -- 8 h au passage à l'heure d'été, ce qu'une heure UTC fixe ne garantit pas.
  hour_local     INTEGER NOT NULL DEFAULT 8 CHECK (hour_local BETWEEN 0 AND 23),
  timezone       TEXT NOT NULL DEFAULT 'Europe/Paris',
  weekdays_only  BOOLEAN NOT NULL DEFAULT TRUE,
  max_mails      INTEGER NOT NULL DEFAULT 8 CHECK (max_mails BETWEEN 1 AND 20),
  last_run_at    TIMESTAMPTZ,
  next_run_at    TIMESTAMPTZ,
  last_status    TEXT CHECK (last_status IN ('ok','error','skipped')),
  last_error     TEXT,
  last_count     INTEGER,
  -- Dernière revue : [{ id, from, subject, proposal, reason }], pour que
  -- l'écran de réglage montre ce que Sophie a proposé sans dépendre du push.
  last_result    JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_mail_reviews_due ON agent_mail_reviews(enabled, next_run_at);

ALTER TABLE agent_mail_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_mail_reviews;
CREATE POLICY "tenant_isolation" ON agent_mail_reviews USING (tenant_id = my_tenant_id());

-- 2. Jeton de relais utilisable plusieurs fois, le temps d'UNE revue. Une
-- revue lit plusieurs boîtes et plusieurs messages (chaque lecture est un
-- appel interne, et le jeton à usage unique est consommé dès le premier).
-- La valeur par défaut garde le comportement actuel : un seul usage.
ALTER TABLE agent_mail_relay_tokens ADD COLUMN IF NOT EXISTS max_uses  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_mail_relay_tokens ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;
