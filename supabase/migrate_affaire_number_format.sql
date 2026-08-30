-- Migration: Customizable format for the affaire (project) number.
-- Lets a tenant pick, independently of the prefix (num_prefix_affaire):
--   - whether a dash separates the prefix from the year (num_affaire_sep_prefix)
--   - whether a dash separates the year from the sequence number (num_affaire_sep_seq)
--   - how many digits the sequence number is padded to (num_affaire_digits)
-- Left NULL by default so existing tenants keep their current generated
-- format unchanged until they explicitly configure it (see the fallback
-- logic in server/routes/projects.ts).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_affaire_sep_prefix BOOLEAN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_affaire_sep_seq BOOLEAN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_affaire_digits SMALLINT;
