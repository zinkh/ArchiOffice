-- Panneaux d'affichage : panneau de chantier (réglages par affaire) et panneau
-- d'affichage du permis de construire (mentions réglementaires portées par la
-- fiche du permis). Idempotent : peut être rejoué sans effet.
--
-- `project_site_panels.settings` (jsonb) : format, orientation, image retenue,
-- logos affichés ou non, lignes masquées. Les données du panneau (intervenants,
-- lots, entreprises, logos) ne sont JAMAIS copiées ici : elles sont relues de
-- l'affaire et des fiches contact à chaque génération.

CREATE TABLE IF NOT EXISTS project_site_panels (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_site_panels_project
  ON project_site_panels(tenant_id, project_id);

ALTER TABLE project_site_panels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON project_site_panels;
CREATE POLICY "tenant_isolation" ON project_site_panels
  USING (tenant_id = my_tenant_id());

-- Mentions du panneau d'affichage du permis (art. A424-15 et suivants du Code de l'urbanisme).
ALTER TABLE permits ADD COLUMN IF NOT EXISTS nature_projet          TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS superficie_terrain_m2  NUMERIC;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS surface_plancher_m2    NUMERIC;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS nombre_logements       INTEGER;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS hauteur_m              NUMERIC;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS mairie_nom             TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS mairie_adresse         TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS numero_decision        TEXT;
