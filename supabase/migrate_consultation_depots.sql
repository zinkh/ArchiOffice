-- ============================================================
-- MIGRATION : espace public de dépôt des offres (module ACT)
-- À exécuter dans le SQL Editor Supabase
-- ============================================================
--
-- Une entreprise consultée reçoit un lien personnel (sans compte) et remet son
-- offre par saisie en ligne, bordereau chiffré ou fichiers (PDF, Word, Excel,
-- ODS, ODT). Fonction réservée au plan Enterprise et aux marchés privés ; les
-- fichiers partent TOUJOURS sur l'espace de stockage externe du cabinet
-- (Google Drive, Dropbox, Nextcloud, kDrive), jamais dans Supabase Storage.
--
-- Trois tables, toutes hors SYNC_TABLES (rien à propager vers un poste local) :
--   - consultation_depot_settings : réglages d'une consultation (date limite,
--     plis scellés, consignes, pièces publiées sur le portail) ;
--   - consultation_depot_invites  : un lien par entreprise ; seul le HACHÉ du
--     jeton est stocké ;
--   - consultation_depots         : zone d'attente des remises. Un dépôt
--     n'écrase JAMAIS l'offre : l'architecte l'intègre explicitement.

-- ------------------------------------------------------------
-- 1. Réglages d'une consultation
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultation_depot_settings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  -- Date limite de remise. Un dépôt reçu après n'est PAS refusé : il est
  -- signalé « hors délai » (hors_delai sur consultation_depots).
  deadline_at TIMESTAMPTZ,
  -- Plis scellés : tant que deadline_at n'est pas atteinte, le cabinet voit
  -- qu'un dépôt existe mais ne peut ni l'ouvrir ni le lire.
  sealed      BOOLEAN NOT NULL DEFAULT false,
  instructions TEXT,
  -- Documents de l'affaire (table documents) proposés au téléchargement sur le
  -- portail. Le DCE de la consultation ne porte que des intitulés : seule une
  -- publication explicite expose un fichier.
  published_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS consultation_depot_settings_project_idx
  ON consultation_depot_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_consultation_depot_settings_tenant
  ON consultation_depot_settings(tenant_id);

ALTER TABLE consultation_depot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consultation_depot_settings;
CREATE POLICY tenant_isolation ON consultation_depot_settings
  USING (tenant_id = my_tenant_id());

-- ------------------------------------------------------------
-- 2. Invitations : un lien par entreprise consultée
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultation_depot_invites (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  -- Identifiant de l'entreprise DANS consultation.entreprises (jsonb) : pas de
  -- clé étrangère possible, c'est une valeur du document.
  entreprise_id TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email         TEXT,
  lots_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- SHA-256 (hex) du jeton : un vol de base ne donne aucun lien utilisable.
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS consultation_depot_invites_token_idx
  ON consultation_depot_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_consultation_depot_invites_project
  ON consultation_depot_invites(tenant_id, project_id);

ALTER TABLE consultation_depot_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consultation_depot_invites;
CREATE POLICY tenant_isolation ON consultation_depot_invites
  USING (tenant_id = my_tenant_id());

-- ------------------------------------------------------------
-- 3. Dépôts : la zone d'attente
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultation_depots (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  invite_id     UUID REFERENCES consultation_depot_invites(id) ON DELETE CASCADE NOT NULL,
  entreprise_id TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  -- Lot visé (project_lots.id) ; NULL = remise générale (tous lots).
  lot_id        TEXT,
  -- 'fichier' | 'bordereau' | 'acte' | 'saisie'
  kind          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  -- Référence archioffice+external://... ; NULL pour une saisie en ligne.
  file_url      TEXT,
  file_name     TEXT,
  mime_type     TEXT,
  size_bytes    BIGINT,
  -- Empreinte SHA-256 des octets reçus : valeur probatoire de l'accusé.
  sha256        TEXT,
  -- Contenu d'une saisie en ligne (montants, options, délai, observations).
  payload       JSONB,
  note          TEXT,
  -- 'recu' | 'integre' | 'rejete' | 'retire'
  status        TEXT NOT NULL DEFAULT 'recu',
  hors_delai    BOOLEAN NOT NULL DEFAULT false,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID
);
CREATE INDEX IF NOT EXISTS idx_consultation_depots_project
  ON consultation_depots(tenant_id, project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultation_depots_invite
  ON consultation_depots(invite_id);

ALTER TABLE consultation_depots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consultation_depots;
CREATE POLICY tenant_isolation ON consultation_depots
  USING (tenant_id = my_tenant_id());
