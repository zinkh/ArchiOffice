-- ============================================================
-- MIGRATION : Connecteurs de messagerie (Correspondance projet/contact)
-- À exécuter dans le SQL Editor Supabase
-- ============================================================
--
-- Deux tables, sur le même principe que calendar_connections /
-- calendar_event_links (migrate_calendar_sync.sql) : la connexion à la
-- messagerie est strictement personnelle (un utilisateur connecte sa
-- propre boîte), donc une table par utilisateur plutôt qu'une colonne de
-- plus sur `settings` (qui reste, elle, l'émetteur SMTP partagé du
-- cabinet pour les factures/notifications).
--
-- email_connections couvre deux façons de s'authentifier :
--  - provider='google', auth_type='oauth'  : OAuth2 (access/refresh token),
--    même client Google que Google Calendar (VITE_GOOGLE_CLIENT_ID /
--    GOOGLE_CLIENT_SECRET), scope Gmail en lecture seule.
--  - provider='infomaniak', auth_type='imap' : IMAP standard avec des
--    identifiants directs (host/port/user/pass) — Infomaniak n'expose pas
--    d'API de lecture de messages, seulement une API de gestion
--    d'hébergement. Le mot de passe est chiffré côté application avant
--    stockage (server/secretsCrypto.ts) : contrairement à un refresh
--    token OAuth révocable côté fournisseur, c'est un mot de passe de
--    boîte mail réelle.
CREATE TABLE IF NOT EXISTS email_connections (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,               -- 'google' | 'infomaniak'
  auth_type TEXT NOT NULL,              -- 'oauth' | 'imap'
  -- Colonnes OAuth (provider='google')
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scopes TEXT,
  -- Colonnes IMAP (provider='infomaniak', ou tout autre hôte IMAP)
  imap_host TEXT,
  imap_port INTEGER,
  imap_username TEXT,
  imap_password_encrypted TEXT,
  -- Communes
  external_account_email TEXT,          -- affiché dans l'UI ("Connecté en tant que ...")
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_connections_user_provider_idx
  ON email_connections(user_id, provider);

-- Rattache un message externe (Gmail ou IMAP) à une fiche ArchiOffice.
-- Ne stocke jamais le corps du message ni les pièces jointes — uniquement
-- les métadonnées nécessaires à l'affichage d'une liste, pour rester un
-- connecteur de liaison et non un client mail (pas de boîte de réception
-- locale).
CREATE TABLE IF NOT EXISTS email_links (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,               -- 'google' | 'infomaniak'
  local_type TEXT NOT NULL,             -- 'project' | 'contact' | 'tender' | 'proposal'
  local_id TEXT NOT NULL,
  external_message_id TEXT NOT NULL,    -- id de message Gmail, ou "dossierIMAP:UID"
  external_thread_id TEXT,
  subject TEXT,
  snippet TEXT,
  from_address TEXT,
  to_addresses TEXT,
  message_date TIMESTAMPTZ,
  linked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_links_unique_idx
  ON email_links(local_type, local_id, provider, external_message_id);
CREATE INDEX IF NOT EXISTS email_links_local_idx ON email_links(local_type, local_id);
CREATE INDEX IF NOT EXISTS email_links_tenant_idx ON email_links(tenant_id);

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_links ENABLE ROW LEVEL SECURITY;

-- AND (pas OR comme pour certaines tables partagées) : la connexion à la
-- messagerie est strictement personnelle, jamais visible du reste du tenant.
DROP POLICY IF EXISTS tenant_isolation ON email_connections;
CREATE POLICY tenant_isolation ON email_connections
  USING (tenant_id = my_tenant_id() AND user_id = auth.uid());

-- Les liens, en revanche, doivent être visibles par toute l'équipe du
-- tenant qui consulte la fiche projet/contact (pas seulement par celui qui
-- a fait le rattachement) — donc isolation au niveau tenant uniquement.
DROP POLICY IF EXISTS tenant_isolation ON email_links;
CREATE POLICY tenant_isolation ON email_links
  USING (tenant_id = my_tenant_id());
