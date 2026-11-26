-- Migration : dossiers libres sous les phases d'une affaire (GED)
--
-- Jusqu'ici l'arborescence des documents (affaire, phase) se déduisait des documents eux-mêmes et
-- aucun dossier ne pouvait être créé. Un dossier appartient à UNE affaire et UNE phase, et peut en
-- contenir d'autres (parent_id). Il est logique : le fichier reste où il est chez le fournisseur de
-- stockage. Un document n'est rangé que dans un dossier de sa propre affaire et de sa propre phase.
-- Voir server/routes/documentFolders.ts et src/pages/Ged.tsx. Hors SYNC_TABLES.

CREATE TABLE IF NOT EXISTS document_folders (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  phase TEXT NOT NULL,
  parent_id TEXT REFERENCES document_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deux dossiers de même nom (casse et espaces ignorés) ne coexistent pas au même endroit.
CREATE UNIQUE INDEX IF NOT EXISTS document_folders_unique_name
  ON document_folders (tenant_id, project_id, phase, COALESCE(parent_id, ''), lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_document_folders_tenant_project
  ON document_folders (tenant_id, project_id);

ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON document_folders;
CREATE POLICY "tenant_isolation" ON document_folders
  USING (tenant_id = my_tenant_id());

-- Supprimer un dossier détache ses documents (le serveur refuse de toute façon un dossier non vide).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES document_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents (folder_id) WHERE folder_id IS NOT NULL;
