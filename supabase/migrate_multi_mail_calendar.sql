-- ============================================================
-- MIGRATION : Plusieurs adresses mail et plusieurs calendriers,
-- avec un défaut par utilisateur
-- À exécuter dans le SQL Editor Supabase
-- ============================================================
--
-- Jusqu'ici email_connections et calendar_connections portaient un index
-- UNIQUE(user_id, provider) : une seule boîte Gmail, une seule Outlook, une
-- seule IMAP par utilisateur, une seule connexion Google Calendar. Un
-- architecte a pourtant plusieurs adresses (cabinet, personnelle, dédiée aux
-- AO) et parfois plusieurs calendriers utiles (agenda personnel + agenda
-- partagé « Chantiers »).
--
-- Le principe repris ici est celui déjà en place pour document_templates
-- (migrate_onboarding_wizard.sql) : une colonne is_default BOOLEAN + un index
-- UNIQUE partiel WHERE is_default = true, qui garantit au plus un défaut par
-- utilisateur sans empêcher d'en avoir zéro ou plusieurs comptes.

-- ------------------------------------------------------------
-- 1. email_connections : plusieurs comptes par fournisseur
-- ------------------------------------------------------------
DROP INDEX IF EXISTS email_connections_user_provider_idx;

ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS is_default   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS display_name TEXT;
-- Envoi SMTP propre au compte : sans ça, une boîte IMAP se lit mais s'écrit
-- toujours avec l'adresse SMTP du cabinet (IMAP n'a pas de capacité d'envoi,
-- le protocole n'en a simplement pas). Chiffré comme imap_password_encrypted
-- (server/secretsCrypto.ts).
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS smtp_host               TEXT;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS smtp_port               INTEGER;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS smtp_username           TEXT;
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS smtp_password_encrypted TEXT;

-- external_account_email est toujours renseigné (userinfo Google/Microsoft à
-- la connexion, username saisi pour IMAP) : le back-fill peut s'appuyer dessus
-- sans risquer deux lignes à email NULL qui échapperaient à l'unicité.
UPDATE email_connections SET external_account_email = imap_username
  WHERE external_account_email IS NULL AND imap_username IS NOT NULL;

-- Une même adresse ne se connecte qu'une fois ; deux adresses différentes
-- chez le même fournisseur sont désormais permises.
CREATE UNIQUE INDEX IF NOT EXISTS email_connections_user_account_idx
  ON email_connections(user_id, provider, external_account_email);

-- Le compte le plus ancien de chaque utilisateur devient son défaut, pour que
-- personne ne se retrouve sans défaut après la migration.
UPDATE email_connections SET is_default = true
  WHERE id IN (
    SELECT DISTINCT ON (user_id) id FROM email_connections ORDER BY user_id, created_at ASC
  );

-- Au plus une adresse par défaut par utilisateur.
CREATE UNIQUE INDEX IF NOT EXISTS email_connections_one_default_per_user_idx
  ON email_connections(user_id) WHERE is_default = true;

-- ------------------------------------------------------------
-- 2. email_links : rattacher un message au bon compte
-- ------------------------------------------------------------
-- Sans connection_id, deux comptes du même fournisseur entreraient en
-- collision d'unicité sur le même external_message_id.
ALTER TABLE email_links ADD COLUMN IF NOT EXISTS connection_id TEXT
  REFERENCES email_connections(id) ON DELETE CASCADE;

-- Back-fill au mieux : la seule connexion de ce provider pour cet
-- utilisateur au moment de la migration (le cas d'avant ce changement).
-- Les liens qui ne se rattachent pas ainsi (utilisateur déjà multi-comptes
-- au moment de la migration, cas rarissime) gardent connection_id NULL —
-- Postgres tient les NULL pour distincts, donc ils restent libres de se
-- répéter sans violer l'unicité (même principe que
-- article_prix_observations.source_ref, cf. CLAUDE.md).
UPDATE email_links l SET connection_id = c.id
  FROM email_connections c
  WHERE l.connection_id IS NULL
    AND c.user_id = l.user_id
    AND c.provider = l.provider
    AND (SELECT COUNT(*) FROM email_connections c2 WHERE c2.user_id = l.user_id AND c2.provider = l.provider) = 1;

DROP INDEX IF EXISTS email_links_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS email_links_unique_idx
  ON email_links(local_type, local_id, connection_id, external_message_id);

-- ------------------------------------------------------------
-- 2bis. email_folder_links : un dossier lié appartient à un COMPTE précis
-- ------------------------------------------------------------
-- L'index d'origine UNIQUE(user_id, provider, folder_id, local_type,
-- local_id) suppose un seul compte par fournisseur : deux comptes Gmail
-- ont chacun un label "INBOX", qui collisionnerait sur cet index. connection_id
-- déterminant déjà user_id et provider (c'est une FK vers email_connections),
-- le nouvel index s'appuie dessus directement.
DROP INDEX IF EXISTS email_folder_links_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS email_folder_links_unique_idx
  ON email_folder_links(connection_id, folder_id, local_type, local_id);

-- ------------------------------------------------------------
-- 3. calendar_connections : un compte, plusieurs calendriers
-- ------------------------------------------------------------
-- external_calendar_id reste en place (lu par le back-fill de
-- calendar_calendars ci-dessous) mais devient historique : la cible
-- d'écriture vit désormais dans calendar_calendars.is_default.
DROP INDEX IF EXISTS calendar_connections_user_provider_idx;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_connections_user_account_idx
  ON calendar_connections(user_id, provider, external_account_email);

-- ------------------------------------------------------------
-- 4. calendar_calendars (nouvelle) : les calendriers d'un compte
-- ------------------------------------------------------------
-- Deux booléens distincts et non un seul : on veut pouvoir AFFICHER
-- plusieurs calendriers en lecture (sync_enabled) tout en n'ÉCRIVANT que
-- dans un seul (is_default, la cible du push ArchiOffice → Google).
CREATE TABLE IF NOT EXISTS calendar_calendars (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  connection_id TEXT REFERENCES calendar_connections(id) ON DELETE CASCADE NOT NULL,
  external_calendar_id TEXT NOT NULL,
  display_name TEXT,
  color TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,   -- cible d'écriture du push
  sync_enabled BOOLEAN NOT NULL DEFAULT false, -- affiché en lecture dans /calendar
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_calendars_connection_idx
  ON calendar_calendars(connection_id, external_calendar_id);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_calendars_one_default_per_user_idx
  ON calendar_calendars(user_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS calendar_calendars_tenant_idx ON calendar_calendars(tenant_id);

ALTER TABLE calendar_calendars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calendar_calendars;
CREATE POLICY tenant_isolation ON calendar_calendars
  USING (tenant_id = my_tenant_id() AND user_id = auth.uid());

-- Back-fill : une ligne par connexion existante, pour retrouver exactement
-- le comportement actuel (le calendrier 'primary' du compte, synchronisé).
INSERT INTO calendar_calendars (id, tenant_id, user_id, connection_id, external_calendar_id, display_name, is_default, sync_enabled)
  SELECT
    c.id || '-primary',
    c.tenant_id, c.user_id, c.id,
    COALESCE(c.external_calendar_id, 'primary'),
    'Principal',
    true, true
  FROM calendar_connections c
  WHERE NOT EXISTS (SELECT 1 FROM calendar_calendars cc WHERE cc.connection_id = c.id);

-- ------------------------------------------------------------
-- 5. calendar_event_links : un jalon peut vivre dans plusieurs calendriers
-- ------------------------------------------------------------
ALTER TABLE calendar_event_links ADD COLUMN IF NOT EXISTS calendar_id TEXT
  REFERENCES calendar_calendars(id) ON DELETE CASCADE;

UPDATE calendar_event_links l SET calendar_id = cc.id
  FROM calendar_calendars cc
  WHERE l.calendar_id IS NULL AND cc.connection_id = (
    SELECT c.id FROM calendar_connections c
    WHERE c.user_id = l.user_id AND c.provider = l.provider
    LIMIT 1
  ) AND cc.is_default = true;

DROP INDEX IF EXISTS calendar_event_links_local_idx;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_links_local_idx
  ON calendar_event_links(user_id, calendar_id, local_type, local_id);
