-- Migration : synchronisation desktop (Explorateur Windows, Finder macOS)
--
-- Socle serveur du contrat docs/desktop-sync-contract.md : appareils, verrous de
-- document, journal de changements, sessions de dépôt par morceaux, et quatre colonnes
-- sur `documents` (empreinte, suppression logique, conflit, date de modification).
--
-- Additive et rejouable : aucune colonne existante n'est modifiée ni supprimée. Hors
-- SYNC_TABLES : un poste Electron ne réplique ni les jetons d'appareil ni le journal.
--
-- Choix à ne pas défaire :
--  * `desktop_changes.tenant_id` n'a PAS de clé étrangère vers `tenants`. Les
--    déclencheurs ci-dessous écrivent dans cette table à chaque suppression d'un
--    document ; la suppression d'un cabinet supprime ses documents en cascade, et une
--    clé étrangère ferait échouer toute la suppression (ligne insérée pour un cabinet
--    en cours de suppression). Le journal est nettoyé par `desktop_changes_prune` et
--    par la fermeture du cabinet (server/tenantPurge.ts).
--  * `desktop_devices` est rattaché à la PERSONNE, pas à un cabinet : un architecte qui
--    exerce dans deux structures a un seul appareil, le cabinet se désigne à chaque
--    requête par `X-Tenant-Id`.

-- ── Appareils ────────────────────────────────────────────────────────────────
-- Le jeton n'est jamais stocké : seul son SHA-256 l'est.
CREATE TABLE IF NOT EXISTS desktop_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL
    CONSTRAINT desktop_devices_platform_check CHECK (platform IN ('windows', 'macos')),
  app_version TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_desktop_devices_user ON desktop_devices(user_id);

-- ── Verrous ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_locks (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT,
  device_id TEXT,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_locks_tenant ON document_locks(tenant_id);

-- ── Sessions de dépôt par morceaux ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS desktop_uploads (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_id TEXT,
  target JSONB NOT NULL,
  base_version INTEGER,
  bump_indice BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL,
  mime_type TEXT,
  description TEXT,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  received JSONB NOT NULL DEFAULT '[]',
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  result JSONB
);
CREATE INDEX IF NOT EXISTS idx_desktop_uploads_tenant ON desktop_uploads(tenant_id);

-- ── Colonnes de documents ────────────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS conflict_of TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Réglage du cabinet : mode de verrouillage ────────────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS desktop_lock_mode TEXT NOT NULL DEFAULT 'advisory';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_desktop_lock_mode_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_desktop_lock_mode_check
      CHECK (desktop_lock_mode IN ('off', 'advisory', 'enforced'));
  END IF;
END $$;

-- ── Journal de changements ───────────────────────────────────────────────────
-- Une séquence globale, filtrée par cabinet à la lecture : le curseur d'un client est
-- un `seq`, jamais une date.
CREATE TABLE IF NOT EXISTS desktop_changes (
  seq BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  type TEXT NOT NULL
    CONSTRAINT desktop_changes_type_check CHECK (type IN ('upsert', 'delete', 'lock', 'unlock', 'scope')),
  node_id TEXT NOT NULL,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_desktop_changes_tenant_seq ON desktop_changes(tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_desktop_changes_created ON desktop_changes(created_at);

-- Plus petit curseur encore servable. Un client dont le curseur est inférieur reçoit
-- 410 CURSOR_EXPIRED et refait une synchronisation complète.
CREATE TABLE IF NOT EXISTS desktop_sync_state (
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);
INSERT INTO desktop_sync_state (key, value) VALUES ('floor_seq', 0) ON CONFLICT (key) DO NOTHING;

-- Purge les événements plus anciens que `p_retain` et relève le plancher. Appelée par
-- le serveur (rôle service), jamais par un compte connecté.
CREATE OR REPLACE FUNCTION desktop_changes_prune(p_retain INTERVAL DEFAULT INTERVAL '30 days')
RETURNS BIGINT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_max BIGINT;
  v_deleted BIGINT;
BEGIN
  SELECT max(seq) INTO v_max FROM desktop_changes WHERE created_at < now() - p_retain;
  IF v_max IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE desktop_sync_state SET value = GREATEST(value, v_max) WHERE key = 'floor_seq';
  DELETE FROM desktop_changes WHERE seq <= v_max;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ── Déclencheurs ─────────────────────────────────────────────────────────────
-- Plusieurs chemins du serveur écrivent dans `documents` (dépôts, DOE, agents, MCP,
-- migration de stockage) : le journal se tient donc en base et non dans les routes.
-- Seuls les documents d'affaire (`resource_type = 'projects'`) intéressent le client.

CREATE OR REPLACE FUNCTION desktop_documents_touch() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_desktop_documents_touch ON documents;
CREATE TRIGGER trg_desktop_documents_touch
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION desktop_documents_touch();

CREATE OR REPLACE FUNCTION desktop_documents_journal() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_row documents;
  v_type TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_type := 'delete';
  ELSE
    v_row := NEW;
    v_type := CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'upsert' END;
  END IF;
  IF v_row.resource_type IS DISTINCT FROM 'projects' THEN
    RETURN NULL;
  END IF;
  INSERT INTO desktop_changes (tenant_id, type, node_id, project_id)
    VALUES (v_row.tenant_id, v_type, 'doc:' || v_row.id, v_row.project_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_desktop_documents_journal ON documents;
CREATE TRIGGER trg_desktop_documents_journal
  AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION desktop_documents_journal();

CREATE OR REPLACE FUNCTION desktop_locks_journal() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO desktop_changes (tenant_id, type, node_id)
      VALUES (OLD.tenant_id, 'unlock', 'doc:' || OLD.document_id);
  ELSE
    INSERT INTO desktop_changes (tenant_id, type, node_id)
      VALUES (NEW.tenant_id, 'lock', 'doc:' || NEW.document_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_desktop_locks_journal ON document_locks;
CREATE TRIGGER trg_desktop_locks_journal
  AFTER INSERT OR UPDATE OR DELETE ON document_locks
  FOR EACH ROW EXECUTE FUNCTION desktop_locks_journal();

-- Une affaire qui change de nom, de code ou d'archivage change le chemin de tous ses
-- fichiers : un événement `scope` force le client à relire le dossier. Les colonnes
-- sont lues par to_jsonb pour ne pas dépendre d'une instance déjà migrée pour l'archivage.
CREATE OR REPLACE FUNCTION desktop_projects_journal() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.project_code IS DISTINCT FROM OLD.project_code
     OR (to_jsonb(NEW)->>'archived_at') IS DISTINCT FROM (to_jsonb(OLD)->>'archived_at') THEN
    INSERT INTO desktop_changes (tenant_id, type, node_id, project_id)
      VALUES (NEW.tenant_id, 'scope', 'prj:' || NEW.id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_desktop_projects_journal ON projects;
CREATE TRIGGER trg_desktop_projects_journal
  AFTER UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION desktop_projects_journal();

-- ── Sécurité ─────────────────────────────────────────────────────────────────
-- Le serveur (rôle service) est le seul lecteur : RLS active, aucune politique, donc
-- aucun accès pour `anon` ni `authenticated`. La fonction de purge n'est appelable que
-- par le rôle service.
ALTER TABLE desktop_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktop_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktop_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktop_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION desktop_changes_prune(INTERVAL) FROM PUBLIC;
-- anon et authenticated n'existent que sur Supabase : un Postgres ordinaire (CI, poste Electron) n'a pas ces rôles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION desktop_changes_prune(INTERVAL) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION desktop_changes_prune(INTERVAL) FROM authenticated;
  END IF;
END $$;
