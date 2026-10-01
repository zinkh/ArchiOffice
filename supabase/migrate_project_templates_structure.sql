-- Modèles de projet : une trame d'affaire complète (lots, jalons, tâches types)
-- au lieu de quatre valeurs de préremplissage.
--
-- Les trois listes sont du jsonb : `default_milestones` et `default_tasks`
-- portent des délais RELATIFS au démarrage de l'affaire (jours), jamais des
-- dates absolues. `catalog_key` repère un modèle installé depuis le catalogue
-- de démarrage (server/projectTemplateCatalog.ts), ce qui empêche de
-- l'installer deux fois sans que le cabinet ait à garder le nom d'origine.

ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS operation_type TEXT;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS marche_type TEXT;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS default_lots JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS default_milestones JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS default_tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS catalog_key TEXT;

ALTER TABLE project_templates DROP CONSTRAINT IF EXISTS project_templates_operation_type_check;
ALTER TABLE project_templates ADD CONSTRAINT project_templates_operation_type_check
  CHECK (operation_type IS NULL OR operation_type IN ('neuf', 'rehabilitation', 'extension', 'maison_individuelle', 'permis_seul', 'autre'));

ALTER TABLE project_templates DROP CONSTRAINT IF EXISTS project_templates_marche_type_check;
ALTER TABLE project_templates ADD CONSTRAINT project_templates_marche_type_check
  CHECK (marche_type IS NULL OR marche_type IN ('prive', 'public'));

-- Un cabinet n'a qu'une copie de chaque entrée du catalogue. Les modèles
-- saisis à la main (catalog_key NULL) restent libres de se répéter.
CREATE UNIQUE INDEX IF NOT EXISTS project_templates_tenant_catalog_key_idx
  ON project_templates (tenant_id, catalog_key)
  WHERE catalog_key IS NOT NULL;
