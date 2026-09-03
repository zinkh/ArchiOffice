-- ============================================================
-- ArchiOffice — Migration : autonomie des agents IA
-- ============================================================
-- Quatre changements, tous pilotés agent par agent depuis /agents/:id :
--   1. de nouvelles capacités (messagerie, cartographie, lecture CCTP/DPGF)
--      dans le même esprit que web_fetch_enabled : une colonne par capacité,
--      pas une entrée de plus dans action_scopes, parce que le risque et le
--      réglage ne sont pas de même nature qu'une écriture CRUD interne ;
--   2. l'écriture et le référentiel interne activés par défaut, y compris
--      pour les agents déjà créés (backfill plus bas) ;
--   3. un moteur d'alertes métier (agent_alert_rules / agent_alerts) ;
--   4. des exécutions planifiées d'agents (agent_schedules /
--      agent_schedule_runs).

-- ── 1. Nouvelles capacités par agent ────────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mail_enabled       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS geo_enabled        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS docs_read_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
-- Envoi de mail réellement autorisé : lecture et envoi sont deux paliers
-- distincts, un agent peut dépouiller une boîte sans pouvoir écrire dehors.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mail_send_enabled  BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Valeurs par défaut : référentiel interne + écriture ──────────────────
-- firm_knowledge pour tout le monde (templates système compris).
UPDATE agents
   SET context_scopes = array_append(context_scopes, 'firm_knowledge')
 WHERE NOT ('firm_knowledge' = ANY (context_scopes));

-- Périmètre d'écriture par défaut, par métier. Appliqué aux templates
-- système ET aux agents déjà instanciés dont action_scopes est encore vide
-- (un cabinet qui a délibérément retiré des permissions garde son réglage :
-- on ne touche jamais à un tableau non vide).
DO $$
DECLARE
  defaults JSONB := '{
    "secretaire":          ["contacts","meetings","tasks","milestones","projects"],
    "charge-projet":       ["projects","tasks","milestones","meetings","contacts","ordres_de_service","visas","receptions","reserves"],
    "pilote-chantier":     ["meetings","tasks","ordres_de_service","visas","receptions","reserves","marches_entreprises"],
    "economiste":          ["proposals","marches_entreprises","notes_honoraires","specifications"],
    "comptable":           ["invoices","notes_honoraires","contrats_moe"],
    "juridique":           ["contrats_moe","ordres_de_service","tenders"],
    "responsable-hqe":     ["specifications","tasks"],
    "ingenieur-thermique": ["specifications"],
    "ingenieur-structure": ["specifications"],
    "ingenieur-fluides":   ["specifications"],
    "acousticien":         ["specifications"],
    "paysagiste":          ["specifications","tasks"],
    "urbaniste":           ["contacts","meetings","tasks","projects"]
  }'::jsonb;
  slug_key TEXT;
BEGIN
  FOR slug_key IN SELECT jsonb_object_keys(defaults) LOOP
    UPDATE agents
       SET action_scopes = ARRAY(SELECT jsonb_array_elements_text(defaults -> slug_key))
     WHERE slug = slug_key
       AND (action_scopes IS NULL OR cardinality(action_scopes) = 0);
  END LOOP;
END $$;

-- Capacités par défaut cohérentes avec le métier de chaque template.
UPDATE agents SET docs_read_enabled = TRUE
 WHERE slug IN ('economiste','responsable-hqe','ingenieur-thermique','ingenieur-structure',
                'ingenieur-fluides','acousticien','charge-projet');
UPDATE agents SET geo_enabled = TRUE
 WHERE slug IN ('urbaniste','paysagiste','charge-projet','pilote-chantier');
-- Lecture de la messagerie pour les postes qui dépouillent le courrier ;
-- l'envoi reste un second interrupteur, décoché partout par défaut.
UPDATE agents SET mail_enabled = TRUE
 WHERE slug IN ('secretaire','charge-projet','comptable');

-- ── 3. Moteur d'alertes ────────────────────────────────────────────────────
-- Une ligne de règle par cabinet et par code, créée à la volée par
-- server/agentAlerts.ts au premier cycle (les codes vivent dans le code, pas
-- en base : une règle inconnue du serveur est simplement ignorée).
CREATE TABLE IF NOT EXISTS agent_alert_rules (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  code           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Seuil en jours ; NULL = seuil par défaut de la règle côté serveur.
  threshold_days INTEGER,
  -- 'info' | 'warning' | 'critical' — pilote la mise en avant et l'email.
  severity       TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  notify_email   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS agent_alerts (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  rule_code    TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  -- Identité stable de la situation détectée (ex. projet X + règle Y) : c'est
  -- elle qui évite de recréer la même alerte à chaque cycle de 6 h, et qui
  -- permet de refermer automatiquement une alerte dont la cause a disparu.
  dedup_key    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  detected_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  notified_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_tenant_status ON agent_alerts(tenant_id, status, detected_at DESC);

-- ── 4. Exécutions planifiées ───────────────────────────────────────────────
-- Une planification = un agent + une consigne + une cadence. L'exécution est
-- volontairement en lecture seule (voir server/agentScheduler.ts) : hors
-- session utilisateur il n'y a pas de jeton d'authentification à transmettre
-- à l'API interne, donc pas d'écriture ni d'envoi de mail sans surveillance.
CREATE TABLE IF NOT EXISTS agent_schedules (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  agent_id      UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily','weekly','monthly')),
  hour_utc      INTEGER NOT NULL DEFAULT 6 CHECK (hour_utc BETWEEN 0 AND 23),
  weekday       INTEGER CHECK (weekday BETWEEN 0 AND 6),   -- 0 = dimanche, pour frequency='weekly'
  day_of_month  INTEGER CHECK (day_of_month BETWEEN 1 AND 28), -- pour frequency='monthly'
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_due ON agent_schedules(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS agent_schedule_runs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  schedule_id   UUID REFERENCES agent_schedules(id) ON DELETE CASCADE NOT NULL,
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','skipped')),
  reply         TEXT,
  error         TEXT,
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  cost_eur_cents INTEGER,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_schedule_runs_schedule ON agent_schedule_runs(schedule_id, started_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE agent_alert_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedule_runs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON agent_alert_rules;
CREATE POLICY "tenant_isolation" ON agent_alert_rules   USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON agent_alerts;
CREATE POLICY "tenant_isolation" ON agent_alerts        USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON agent_schedules;
CREATE POLICY "tenant_isolation" ON agent_schedules     USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON agent_schedule_runs;
CREATE POLICY "tenant_isolation" ON agent_schedule_runs USING (tenant_id = my_tenant_id());
