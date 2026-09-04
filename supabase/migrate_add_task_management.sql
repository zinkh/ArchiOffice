-- Migration : gestion des tâches.
--
-- La table `tasks` n'a jamais eu de description, d'assignation, de priorité
-- ni d'horodatage de création — l'interface n'offrait donc aucun moyen de
-- dire QUI fait QUOI, et la ressource agent `tasks`
-- (packages/archioffice-agents/src/types.ts) annonçait déjà `description`
-- au modèle alors que ni la base ni POST /api/tasks ne la stockaient : le
-- champ était silencieusement perdu à chaque écriture.
--
-- `dependencies` reste volontairement TEXT (du JSON sérialisé par
-- supabase-js) : le type est partagé avec milestones.dependencies et les
-- lignes sont rejouées verbatim par le sync desktop (server/syncTables.ts,
-- migrate_add_sync_infra.sql). La lecture est normalisée côté API
-- (server/routes/tasks.ts) plutôt que par un changement de type ; on ne
-- répare ici que les valeurs non parsables.
--
-- assignee_id est TEXT sans clé étrangère, comme project_members.user_id et
-- time_entries.user_id : une FK vers profiles(id) casserait l'ordre
-- d'insertion de server/initialImport.ts.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority    TEXT DEFAULT 'normal';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by  TEXT;

-- Backfill avant contraintes : status est nullable depuis migrate_add_task_status.sql.
UPDATE tasks SET status   = 'todo'   WHERE status   IS NULL OR btrim(status)   = '';
UPDATE tasks SET priority = 'normal' WHERE priority IS NULL OR btrim(priority) = '';
UPDATE tasks SET dependencies = '[]'
  WHERE dependencies IS NULL OR btrim(dependencies) = '' OR btrim(dependencies) NOT LIKE '[%';

-- CHECK tolérants au NULL : le sync desktop et l'import initial insèrent des
-- lignes sans passer par la validation Zod de l'API.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IS NULL OR status IN ('todo','in_progress','review','done'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IS NULL OR priority IN ('low','normal','high','urgent'));

-- GET /api/tasks?project_id=… (onglet Tâches d'un projet) et ?assignee_id=…
-- (widget « Mes tâches ») deviennent des chemins chauds ; la table n'avait
-- aucun index en dehors de sa clé primaire.
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_project  ON tasks(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee ON tasks(tenant_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status   ON tasks(tenant_id, status);
