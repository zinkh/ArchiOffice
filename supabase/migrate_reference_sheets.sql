-- Fiches de référence : métadonnées propres au dossier de références pour les
-- candidatures (ville, département, labels, maître d'œuvre, mission, phase,
-- montant, images retenues). Une ligne par affaire OU par référence saisie à la
-- main. Aucun de ces champs n'existait sur `projects` / `custom_references`.
--
-- `images` : [{ id, document_id, is_primary }]. Les images sont des documents
-- ordinaires (table `documents`, bucket privé) ; la fiche n'en garde que la
-- référence et l'ordre. Une valeur NULL / vide reste « NC » à l'export.

CREATE TABLE IF NOT EXISTS reference_sheets (
  id                   TEXT PRIMARY KEY,
  tenant_id            UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id           TEXT REFERENCES projects(id) ON DELETE CASCADE,
  custom_reference_id  UUID REFERENCES custom_references(id) ON DELETE CASCADE,
  nature               TEXT,
  city                 TEXT,
  department           TEXT,
  labels               TEXT,
  maitre_oeuvre        TEXT,
  mission              TEXT,
  phase                TEXT,
  amount_text          TEXT,
  images               JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((project_id IS NOT NULL) <> (custom_reference_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reference_sheets_project
  ON reference_sheets(tenant_id, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reference_sheets_custom
  ON reference_sheets(tenant_id, custom_reference_id) WHERE custom_reference_id IS NOT NULL;

ALTER TABLE reference_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON reference_sheets;
CREATE POLICY "tenant_isolation" ON reference_sheets
  USING (tenant_id = my_tenant_id());
