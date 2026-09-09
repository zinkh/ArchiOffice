-- proposals.client_id -> contacts(id) was added directly to the production
-- database (never captured here or in schema.sql), so GET /api/proposals'
-- embedded select ('*, proposal_specialties(*), contacts(first_name,
-- last_name)') works in production but 500s on the offline desktop build,
-- whose local Postgres is bootstrapped from schema.sql + these migrate_*.sql
-- files and never had this relationship — PostgREST can't embed contacts
-- without a foreign key to walk. schema.sql now declares it inline for new
-- installs; this migration backfills existing local databases.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposals_client_id_fkey'
  ) THEN
    ALTER TABLE proposals
      ADD CONSTRAINT proposals_client_id_fkey FOREIGN KEY (client_id) REFERENCES contacts(id);
  END IF;
END $$;
