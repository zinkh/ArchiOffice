-- projects on the hosted Supabase project carries 15 columns that were
-- never captured here or in any migrate_*.sql file (same class of drift as
-- migrate_proposals_client_fk.sql and migrate_invoice_project_fk.sql, but on
-- columns rather than a foreign key): lots_list, updated_at, doc_date,
-- date_fin_reelle, date_depot_pc, num_permis_construire, sismicite,
-- retrait_argiles, bet_structure, etude_sol, mission_bim, type_moa,
-- nature_travaux_maf, taux_mission, part_interet, maf_intercalaire.
--
-- This is why the offline Electron client "ne rapatrie pas les projets" :
-- the cloud-link initial import (server/initialImport.ts) and the ongoing
-- inbound sync (server/cloudSync.ts) both do a plain `select('*')` against
-- the CLOUD projects table, then upsert those rows as-is into the LOCAL
-- one via PostgREST. Every row carries these 15 columns, so PostgREST
-- rejects the whole upsert with PGRST204 ("Could not find the 'X' column of
-- 'projects' in the schema cache") — 'projects' sits after 'invoices' in
-- SYNC_TABLES (server/syncTables.ts), so invoices (and everything before
-- 'projects' in that list) import fine while projects never does.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lots_list TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS doc_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS date_fin_reelle DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS date_depot_pc DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS num_permis_construire TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sismicite TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS retrait_argiles TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bet_structure BOOLEAN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS etude_sol BOOLEAN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mission_bim BOOLEAN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS type_moa TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS nature_travaux_maf TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS taux_mission NUMERIC;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS part_interet NUMERIC;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS maf_intercalaire TEXT;
-- Matches the hosted column exactly (NOT NULL DEFAULT now()) so a fresh
-- local row never needs the app to set it explicitly.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- secteur_abf / programme: a different flavor of the same drift, found while
-- fixing the above. server/routes/projects.ts (POST/PUT /api/projects) reads
-- and writes both, and ProjectOverview.tsx has a real editable textarea bound
-- to `project.programme` ("Contexte & programme") — but neither column ever
-- existed anywhere, hosted database included. Saving that field has always
-- 500'd ("column ... does not exist"); this was never specific to the
-- offline client.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS secteur_abf TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS programme TEXT;
