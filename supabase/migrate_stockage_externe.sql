-- ============================================================
-- MIGRATION : stockage des documents et des plans sur l'espace du cabinet
-- (Google Drive, Dropbox, Nextcloud, kDrive)
-- À exécuter dans le SQL Editor Supabase
-- ============================================================
--
-- Tous les fichiers métier vivent aujourd'hui dans Supabase Storage, sur le
-- compte de l'opérateur de la plateforme, facturés à lui et plafonnés par plan
-- (`storage_mb`, src/lib/billing.ts). Un cabinet d'architecture produit des
-- plans et des DCE lourds : c'est le poste qui grossit le plus vite, et le seul
-- qu'il pourrait parfaitement héberger lui-même, puisqu'il a déjà un Drive, un
-- Dropbox, un Nextcloud ou un kDrive.
--
-- Périmètre volontairement restreint aux buckets `documents` (GED, versions,
-- visas) et `plans` : ce sont les seuls qui pèsent. `logos` reste public par
-- construction (identité visuelle du cabinet) et `support-attachments` reste
-- chez nous parce que le superadmin plateforme doit pouvoir les lire depuis
-- /admin/support — un drive de cabinet lui serait inaccessible et la fonction
-- support cesserait de marcher.
--
-- AUCUNE reprise de l'existant : les fichiers déjà déposés sur Supabase y
-- restent et continuent d'être servis exactement comme avant. Seuls les
-- NOUVEAUX dépôts partent sur l'espace du cabinet. Chaque ligne doit donc
-- porter l'information de l'endroit où vit son fichier — d'où la colonne
-- `storage_backend` en fin de fichier.

-- ------------------------------------------------------------
-- 1. external_storage_connections : l'espace de stockage du cabinet
-- ------------------------------------------------------------
-- Une table dédiée, et non quelques colonnes de plus sur `settings` (le modèle
-- Zoho) : il faut des jetons OAuth chiffrés, un cache de dossiers rattaché par
-- clé étrangère, et un état de connexion à afficher. C'est la forme
-- email_connections / calendar_connections, à ceci près que le réglage est
-- celui du CABINET et non d'une personne : un architecte et son collaborateur
-- déposent dans le même espace, donc pas de colonne user_id ni de clause
-- `AND user_id = auth.uid()` dans la policy.
CREATE TABLE IF NOT EXISTS external_storage_connections (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  provider      TEXT NOT NULL,          -- 'google_drive' | 'dropbox' | 'webdav'
  -- Nextcloud et kDrive parlent le même WebDAV et partagent un seul adaptateur.
  -- Cette colonne ne sert qu'à l'affichage et au pré-remplissage du formulaire.
  webdav_flavor TEXT,                   -- 'nextcloud' | 'kdrive'
  display_name  TEXT,
  external_account_email TEXT,

  -- OAuth (google_drive, dropbox) — jetons chiffrés par server/secretsCrypto.ts
  refresh_token TEXT,
  access_token  TEXT,
  expires_at    TIMESTAMPTZ,
  scopes        TEXT,
  drive_id      TEXT,                   -- réservé : Drive partagé Google

  -- WebDAV (nextcloud, kdrive) — mot de passe d'application, jamais le mot de
  -- passe du compte, chiffré comme imap_password_encrypted
  base_url           TEXT,
  username           TEXT,
  password_encrypted TEXT,

  -- Arborescence : <racine>/<code affaire> - <nom affaire>/<phase>/<fichier>
  root_folder_path        TEXT NOT NULL DEFAULT 'ArchiOffice',
  root_folder_external_id TEXT,

  -- État, relu par l'écran Réglages pour dire pourquoi un dépôt échoue
  is_active     BOOLEAN NOT NULL DEFAULT true,
  status        TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'needs_reauth' | 'error'
  last_error    TEXT,
  last_error_at TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Un seul espace actif à la fois par cabinet. Index UNIQUE PARTIEL, même
-- patron que email_connections.is_default (migrate_multi_mail_calendar.sql) :
-- une connexion désactivée reste en base plutôt que d'être supprimée, sans
-- quoi les références `archioffice+external://.../<id de connexion>/...` déjà
-- écrites deviendraient d'un coup irrésolubles et les fichiers déposés chez le
-- cabinet disparaîtraient de l'application.
CREATE UNIQUE INDEX IF NOT EXISTS external_storage_connections_one_active_per_tenant_idx
  ON external_storage_connections(tenant_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_external_storage_connections_tenant
  ON external_storage_connections(tenant_id);

ALTER TABLE external_storage_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON external_storage_connections;
CREATE POLICY tenant_isolation ON external_storage_connections
  USING (tenant_id = my_tenant_id());

-- ------------------------------------------------------------
-- 2. external_storage_folders : le cache de l'arborescence
-- ------------------------------------------------------------
-- Sans ce cache, chaque dépôt coûterait deux à six appels à l'API du
-- fournisseur rien que pour retrouver « <racine>/<affaire>/<phase> ».
-- folder_key est le chemin logique normalisé, external_id l'identifiant chez
-- le fournisseur (id Google Drive, chemin Dropbox ou WebDAV).
CREATE TABLE IF NOT EXISTS external_storage_folders (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  connection_id UUID REFERENCES external_storage_connections(id) ON DELETE CASCADE NOT NULL,
  folder_key    TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ DEFAULT NOW()
);
-- C'est cet index qui rend l'upsert idempotent : deux dépôts simultanés sur la
-- même affaire ne peuvent pas créer deux lignes pour le même dossier.
CREATE UNIQUE INDEX IF NOT EXISTS external_storage_folders_connection_key_idx
  ON external_storage_folders(connection_id, folder_key);
CREATE INDEX IF NOT EXISTS idx_external_storage_folders_tenant
  ON external_storage_folders(tenant_id);

ALTER TABLE external_storage_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON external_storage_folders;
CREATE POLICY tenant_isolation ON external_storage_folders
  USING (tenant_id = my_tenant_id());

-- ------------------------------------------------------------
-- 3. storage_backend : où vit le fichier de cette ligne
-- ------------------------------------------------------------
-- Colonne DÉRIVÉE de file_url, jamais la source de vérité de la résolution :
-- c'est toujours file_url qu'on lit pour retrouver un fichier. Elle n'existe
-- que parce que deux requêtes ont besoin de filtrer en SQL, sans pouvoir
-- analyser une URI : le contrôle de quota (server.ts::checkStorageQuota) et la
-- jauge « Stockage » de l'abonnement (server/routes/billing.ts). Le badge de
-- l'écran Documents s'en sert aussi, plutôt que de refaire l'analyse côté
-- client.
--
-- Le défaut 'supabase' vaut reprise de l'existant : toutes les lignes déjà en
-- base restent comptées dans le quota, ce qui est exactement ce qu'on veut —
-- leurs octets sont bel et bien chez nous.
ALTER TABLE documents         ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'supabase';
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'supabase';
ALTER TABLE plans             ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'supabase';

-- document_versions est la table du quota : c'est elle qu'on somme par cabinet
-- en excluant les octets hébergés ailleurs.
CREATE INDEX IF NOT EXISTS idx_document_versions_tenant_backend
  ON document_versions(tenant_id, storage_backend);
