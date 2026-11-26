-- Migration : les dossiers libres de la GED dans le journal de synchronisation desktop
--
-- Un dossier libre (document_folders, supabase/migrate_document_folders.sql) est un nœud de l'arborescence
-- desktop (`fld:<id>`, server/desktop/nodes.ts). Créer, renommer ou supprimer un dossier change le chemin
-- de tous les fichiers qu'il contient : un événement `scope` sur l'affaire force le client à relire son
-- dossier, comme le fait déjà un changement de nom ou d'archivage de l'affaire (desktop_projects_journal).
-- Le déplacement d'un DOCUMENT dans un dossier passe déjà par le déclencheur de `documents` (upsert).
--
-- À appliquer après migrate_desktop_sync.sql et migrate_document_folders.sql. Rejouable.

CREATE OR REPLACE FUNCTION desktop_document_folders_journal() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_row document_folders;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  INSERT INTO desktop_changes (tenant_id, type, node_id, project_id)
    VALUES (v_row.tenant_id, 'scope', 'prj:' || v_row.project_id, v_row.project_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_desktop_document_folders_journal ON document_folders;
CREATE TRIGGER trg_desktop_document_folders_journal
  AFTER INSERT OR UPDATE OR DELETE ON document_folders
  FOR EACH ROW EXECUTE FUNCTION desktop_document_folders_journal();
