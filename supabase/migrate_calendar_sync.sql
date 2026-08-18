-- ============================================================
-- MIGRATION : Synchronisation Google Calendar (page Calendrier)
-- À exécuter dans le SQL Editor Supabase
-- ============================================================
--
-- Distinct de la table `settings` utilisée par Zoho/Odoo/Ragic : ces
-- intégrations sont partagées à l'échelle du cabinet (un seul identifiant
-- par tenant), alors qu'ici chaque utilisateur connecte son propre compte
-- Google personnel — d'où une table par utilisateur plutôt qu'une colonne
-- de plus sur `settings`.

CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google', -- 'google' aujourd'hui, 'microsoft' en future itération
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  external_calendar_id TEXT,     -- calendrier ciblé chez le fournisseur (défaut 'primary')
  external_account_email TEXT,   -- affiché dans l'UI ("Connecté en tant que ...")
  scopes TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_user_provider_idx
  ON calendar_connections(user_id, provider);

-- Fait le lien entre un jalon/tâche ArchiOffice et l'événement Google créé
-- pour lui, pour que resynchroniser mette à jour le même événement au lieu
-- d'en créer un doublon à chaque fois.
CREATE TABLE IF NOT EXISTS calendar_event_links (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  local_type TEXT NOT NULL,      -- 'milestone' | 'task'
  local_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_links_local_idx
  ON calendar_event_links(user_id, provider, local_type, local_id);
CREATE INDEX IF NOT EXISTS calendar_event_links_tenant_idx ON calendar_event_links(tenant_id);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_links ENABLE ROW LEVEL SECURITY;

-- AND (pas OR comme pour certaines tables partagées) : cette donnée est
-- strictement personnelle, jamais visible du reste du tenant.
DROP POLICY IF EXISTS tenant_isolation ON calendar_connections;
CREATE POLICY tenant_isolation ON calendar_connections
  USING (tenant_id = my_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS tenant_isolation ON calendar_event_links;
CREATE POLICY tenant_isolation ON calendar_event_links
  USING (tenant_id = my_tenant_id() AND user_id = auth.uid());
