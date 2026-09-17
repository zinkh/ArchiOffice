-- Pièces jointes polymorphes : jusqu'ici `documents` ne se rattachait qu'à un
-- projet (`project_id`). resource_type/resource_id généralisent ce
-- rattachement à n'importe quelle fiche du cabinet (permis, appel d'offres,
-- devis, réunion, contrat MOE...) — le déclencheur étant le besoin d'attacher
-- un CERFA et ses notices à une fiche `permits`, qui n'a pas de project_id
-- de document propre.
--
-- `project_id` reste inchangé et continue de faire foi pour tout le code
-- existant (onglet Documents d'une affaire, filtré par project_id) :
-- resource_type vaut 'projects' par défaut et resource_id est backfillé
-- depuis project_id, donc aucune ligne existante ne change de sens.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'projects';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS resource_id TEXT;
-- mime_type/size_bytes existaient déjà sur document_versions (size_bytes
-- seulement) mais pas sur documents elle-même : le MCP a besoin de les
-- rendre sans relire la dernière version à chaque appel.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

UPDATE documents SET resource_id = project_id WHERE resource_id IS NULL AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_tenant_resource ON documents(tenant_id, resource_type, resource_id);
