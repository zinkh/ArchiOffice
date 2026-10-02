-- ── Réserves : commentaire, photos et « projets ouverts récemment » ──────────
--
-- 1. `reserves.description` / `gpa_reserves.description` : le commentaire
--    libre d'une réserve (ce qui reste à faire, l'état constaté), distinct de
--    l'intitulé court.
--
-- 2. `reserve_photos` : les photos prises sur le chantier pour une réserve,
--    sur le modèle de `meeting_photos`. Une seule table pour les deux jeux de
--    réserves (OPR `reserves` et GPA `gpa_reserves`), distingués par
--    `reserve_kind` — une clé étrangère ne peut pas viser deux tables, la
--    suppression en cascade est donc faite par le code applicatif
--    (server/reservePhotos.ts) à la suppression d'une réserve.
--
-- 3. `project_recent_views` : la dernière ouverture de chaque affaire PAR
--    PERSONNE, pour classer la liste des projets par ouverture récente
--    (GET /api/projects renvoie `last_opened_at`). Une ligne par couple
--    (utilisateur, projet), mise à jour à chaque ouverture de la fiche.

ALTER TABLE reserves     ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE gpa_reserves ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS reserve_photos (
  id           TEXT PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  reserve_id   TEXT NOT NULL,
  reserve_kind TEXT NOT NULL DEFAULT 'opr' CHECK (reserve_kind IN ('opr', 'gpa')),
  file_url     TEXT NOT NULL,
  caption      TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reserve_photos_reserve ON reserve_photos(tenant_id, reserve_kind, reserve_id);

CREATE TABLE IF NOT EXISTS project_recent_views (
  id         TEXT PRIMARY KEY,
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_recent_views_user ON project_recent_views(tenant_id, user_id);

ALTER TABLE reserve_photos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_recent_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON reserve_photos;
CREATE POLICY "tenant_isolation" ON reserve_photos
  USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON project_recent_views;
CREATE POLICY "tenant_isolation" ON project_recent_views
  USING (tenant_id = my_tenant_id());
