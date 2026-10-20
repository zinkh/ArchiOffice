-- ============================================================
-- MIGRATION : atelier DOE (onglet AOR)
-- Sollicitation des entreprises, relances automatiques, analyse et visa des
-- dossiers des ouvrages exécutés, archive transmise au maître d'ouvrage.
-- ============================================================
--
-- Les fichiers reçus restent des lignes de `documents` (doc_type = 'DOE'), donc
-- soumis au même stockage (Supabase ou espace externe du cabinet), au même
-- quota et à la même corbeille que le reste de la GED. Trois tables nouvelles,
-- toutes hors SYNC_TABLES, et quatre colonnes sur `documents` :
--   - doe_settings : réglages d'une opération (date limite, consignes, pièces
--     exigées, relances automatiques) ;
--   - doe_requests : un lien personnel par entreprise (seul le HACHÉ du jeton
--     est stocké) et le suivi des relances envoyées ;
--   - doe_visas    : les visas émis, avec le détail des pièces au moment du
--     visa ; le PDF du visa est lui-même un document de l'affaire.

-- ------------------------------------------------------------
-- 1. Colonnes de classement sur documents
-- ------------------------------------------------------------
-- Pièce attendue à laquelle répond le document (plans_execution, notices,
-- fiches_techniques, pv_essais, attestations, garanties, autre) ; NULL = non
-- classé.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doe_piece TEXT;
-- Lot visé (project_lots.id) ; NULL = tous les lots de l'entreprise.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doe_lot_id TEXT;
-- Demande (doe_requests.id) par laquelle le document est arrivé, NULL si le
-- cabinet l'a déposé lui-même.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doe_request_id TEXT;
-- 'entreprise' (portail public) ou 'cabinet'.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doe_source TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_doe
  ON documents(tenant_id, project_id) WHERE doc_type = 'DOE';

-- ------------------------------------------------------------
-- 2. Réglages d'une opération
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doe_settings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  -- Date de remise souhaitée. Un dépôt plus tardif n'est jamais refusé.
  deadline_at TIMESTAMPTZ,
  instructions TEXT,
  -- Pièces exigées pour qu'un dossier soit complet ; NULL = pièces par défaut.
  required_pieces JSONB,
  reminder_enabled BOOLEAN NOT NULL DEFAULT true,
  reminder_interval_days INTEGER NOT NULL DEFAULT 7,
  reminder_max INTEGER NOT NULL DEFAULT 4,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS doe_settings_project_idx ON doe_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_doe_settings_tenant ON doe_settings(tenant_id);

ALTER TABLE doe_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON doe_settings;
CREATE POLICY tenant_isolation ON doe_settings USING (tenant_id = my_tenant_id());

-- ------------------------------------------------------------
-- 3. Demandes : un lien par entreprise
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doe_requests (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  -- Même convention que documents.contact_id : l'identifiant du contact, à
  -- défaut le nom, tel que le porte le lot (project_lots.contact_id/name).
  entreprise_key TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  contact_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  email         TEXT,
  lots_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- SHA-256 (hex) du jeton : un vol de base ne donne aucun lien utilisable.
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ,
  -- Première sollicitation envoyée par e-mail ; NULL tant que le lien n'a pas
  -- été envoyé (il peut avoir été copié à la main).
  sent_at       TIMESTAMPTZ,
  last_reminder_at TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS doe_requests_token_idx ON doe_requests(token_hash);
-- Une seule demande active par entreprise et par opération.
CREATE UNIQUE INDEX IF NOT EXISTS doe_requests_active_idx
  ON doe_requests(tenant_id, project_id, entreprise_key) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doe_requests_project ON doe_requests(tenant_id, project_id);

ALTER TABLE doe_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON doe_requests;
CREATE POLICY tenant_isolation ON doe_requests USING (tenant_id = my_tenant_id());

-- ------------------------------------------------------------
-- 4. Visas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doe_visas (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  entreprise_key TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  -- DOE-AAAA-NNN, séquence atomique next_document_number('doe_visa').
  numero        TEXT NOT NULL,
  -- 'favorable' | 'avec_observations' | 'defavorable'
  avis          TEXT NOT NULL,
  observations  TEXT,
  -- Photographie du dossier au moment du visa : pièces, documents et avis.
  pieces        JSONB NOT NULL DEFAULT '[]'::jsonb,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by     UUID,
  issued_by_name TEXT,
  -- PDF du visa, enregistré comme document de l'affaire.
  document_id   TEXT,
  sent_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS doe_visas_numero_idx ON doe_visas(tenant_id, numero);
CREATE INDEX IF NOT EXISTS idx_doe_visas_project ON doe_visas(tenant_id, project_id, issued_at DESC);

ALTER TABLE doe_visas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON doe_visas;
CREATE POLICY tenant_isolation ON doe_visas USING (tenant_id = my_tenant_id());
