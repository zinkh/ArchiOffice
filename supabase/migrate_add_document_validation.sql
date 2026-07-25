-- Lets documents be tied to an "entreprise" (the contact behind a project
-- lot, same contact_id/contact_name convention used by project lots and
-- reserves) and carry a visa-style validation workflow (pending / approved /
-- rejected / commented + free-form comments), for classifying DOE documents
-- by responsible company. Generic on `documents` so any category can use it,
-- not just DOE.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS contact_id TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS validation_comments TEXT;
