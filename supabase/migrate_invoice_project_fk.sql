-- invoices.project_id -> projects(id) was never declared as a real foreign
-- key, only as a plain TEXT column plus an index (idx_invoices_tenant_project)
-- — same class of bug as migrate_proposals_client_fk.sql. GET /api/invoices'
-- embedded select ('*, projects(name)') needs a real FK constraint for
-- PostgREST to walk, so it 500s with PGRST200 ("Could not find a
-- relationship between 'invoices' and 'projects'") on any Postgres bootstrapped
-- from schema.sql + these migrate_*.sql files alone — notably the offline
-- Electron client, whose local stack has no other way to pick up a
-- constraint that only ever existed on the hosted Supabase project.
-- schema.sql now declares it inline for new installs; this migration
-- backfills existing databases.

-- Deleting a project must never delete its invoices (a facture is a legal
-- document that outlives the affaire) — ON DELETE SET NULL, the same
-- behavior already used for invoices.client_id.

-- Some rows may reference a project_id that no longer exists (nothing ever
-- enforced this relationship, so a deleted project could leave dangling
-- invoices) — null those out first, or adding the constraint below would
-- fail.
UPDATE invoices
SET project_id = NULL
WHERE project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = invoices.project_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_project_id_fkey'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;
