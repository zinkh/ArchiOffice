-- ============================================================
-- MIGRATION : Rattachement d'un dossier mail (Gmail/Outlook/IMAP) à une
-- fiche ArchiOffice — Phase 5 de la Mailbox v2 (cf. migrate_email_sync.sql
-- pour email_connections/email_links, dont cette table est le complément)
-- À exécuter dans le SQL Editor Supabase
-- ============================================================
--
-- email_links (migrate_email_sync.sql) rattache un message précis à une
-- fiche. email_folder_links rattache un DOSSIER entier (un label Gmail, un
-- dossier Outlook, une mailbox IMAP) — l'onglet Correspondance peut alors
-- afficher le contenu live de ce dossier à côté des messages rattachés
-- individuellement, sans avoir à les attacher un par un.
--
-- RLS strictement personnelle (comme email_connections, PAS comme
-- email_links qui est visible par tout le tenant) : un folder_id de label
-- Gmail ou de dossier Outlook n'est résolvable qu'via la connexion OAuth de
-- l'utilisateur qui l'a créé (server/mailFolderLinks.ts résout
-- connection_id → jeton d'accès de CET utilisateur). Un collègue sans sa
-- propre connexion à cette boîte ne doit pas voir un lien qu'il ne peut pas
-- résoudre, ni a fortiori parcourir le contenu d'une boîte mail qui n'est
-- pas la sienne.
CREATE TABLE IF NOT EXISTS email_folder_links (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  connection_id TEXT REFERENCES email_connections(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,               -- 'google' | 'microsoft' | 'infomaniak'
  folder_id TEXT NOT NULL,              -- label id Gmail, folder id Outlook, ou chemin de mailbox IMAP
  folder_name TEXT NOT NULL,            -- nom affiché, capturé au moment du rattachement
  local_type TEXT NOT NULL,             -- 'project' | 'contact' | 'tender' | 'proposal'
  local_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_folder_links_unique_idx
  ON email_folder_links(user_id, provider, folder_id, local_type, local_id);
CREATE INDEX IF NOT EXISTS email_folder_links_local_idx ON email_folder_links(local_type, local_id);
CREATE INDEX IF NOT EXISTS email_folder_links_tenant_idx ON email_folder_links(tenant_id);

ALTER TABLE email_folder_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON email_folder_links;
CREATE POLICY tenant_isolation ON email_folder_links
  USING (tenant_id = my_tenant_id() AND user_id = auth.uid());
