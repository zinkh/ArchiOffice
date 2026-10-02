-- ============================================================
-- ArchiOffice — Migration : intégrations d'automatisation (n8n, IFTTT, ...)
-- ============================================================
-- Deux briques indépendantes, sur le même principe que les autres jetons
-- préfixés déjà dispatchés dans le middleware /api de server.ts
-- (mcp_at_, tg_at_, mail_at_) et que la table d'outbox déjà en place pour
-- les notifications système (notification_outbox) :
--
-- 1. ENTRANT (n8n → ArchiOffice) : une clé d'API "automation_api_keys",
--    préfixe auto_at_, qui agit avec les VRAIS droits de la personne qui
--    l'a émise (même principe que tout le reste des outils d'agent : "une
--    action se comporte exactement comme si l'utilisateur l'avait faite
--    lui-même"). Liaison persistante mais révocable, comme tg_at_ — pas à
--    usage unique comme mail_at_, puisqu'un scénario n8n rappelle la même
--    clé à chaque exécution.
--
-- 2. SORTANT (ArchiOffice → n8n/IFTTT) : "webhooks" (une cible par
--    cabinet, filtrée par types d'évènements) + "webhook_deliveries" (le
--    journal d'envoi, sur le même principe que notification_outbox :
--    une ligne par tentative, jamais écrasée, pour pouvoir rejouer un
--    envoi en échec). Voir server/webhookDispatch.ts.
--
-- Toutes deux gérées exclusivement côté serveur (routes authentifiées,
-- supabaseAdmin, qui contourne RLS) : aucune lecture directe depuis le
-- client Supabase. RLS est quand même activée ci-dessous, en défense en
-- profondeur — sans elle, PostgREST expose ces tables via la clé anon à
-- quiconque la connaît, et webhook_deliveries porte de vraies données
-- métier (payload JSONB), pas seulement des jetons.
--
-- Ni l'une ni l'autre ne rejoint SYNC_TABLES (server/syncTables.ts) :
-- secret de signature et jetons d'API n'ont rien à faire sur une
-- installation locale dont MAIL_ENCRYPTION_KEY diffère — même raison que
-- external_storage_connections.

-- 1. Clés d'API d'automatisation (n8n, ou tout appelant HTTP externe).
CREATE TABLE IF NOT EXISTS automation_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Les droits appliqués à chaque appel sont ceux de CETTE personne — pas
  -- un compte de service séparé, même principe que le jeton d'un agent.
  user_id UUID NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_automation_api_keys_tenant ON automation_api_keys(tenant_id);

-- 2. Webhooks sortants : une cible HTTP par cabinet, abonnée à une liste
--    fermée de types d'évènements (server/webhookEvents.ts fait foi côté
--    code — pas de contrainte CHECK ici, pour ne pas dupliquer ce
--    catalogue en SQL à chaque évènement ajouté).
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  -- Chiffré comme les jetons OAuth des connecteurs (secretsCrypto.ts) : à
  -- la différence d'un mot de passe, il doit rester déchiffrable pour
  -- signer chaque envoi, jamais simplement haché.
  secret_encrypted TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_triggered_at TIMESTAMPTZ,
  last_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id);

-- 3. Journal d'envoi, une ligne par tentative — jamais écrasée, pour
--    pouvoir rejouer un envoi en échec (POST .../deliveries/:id/retry)
--    sans perdre la trace de l'échec d'origine.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);

ALTER TABLE automation_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON automation_api_keys;
CREATE POLICY "tenant_isolation" ON automation_api_keys USING (tenant_id = my_tenant_id());

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON webhooks;
CREATE POLICY "tenant_isolation" ON webhooks USING (tenant_id = my_tenant_id());

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON webhook_deliveries;
CREATE POLICY "tenant_isolation" ON webhook_deliveries USING (tenant_id = my_tenant_id());
