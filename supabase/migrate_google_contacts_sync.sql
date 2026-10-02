-- Bidirectional Google Contacts sync: push ArchiOffice contacts (in
-- categories the cabinet opts into) to Google Contacts, not just pull from
-- it. Needs a way to link a local contact to the Google contact it
-- corresponds to (to update instead of re-creating on every sync, and to
-- compare modification times for conflict resolution), and a per-tenant
-- setting for which contact categories are pushed.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS google_resource_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

-- Array of contact_categories.name values (free-text, matching the existing
-- category vocabulary) selected in Réglages for the push direction. Absent
-- or empty means nothing gets pushed — the pull direction (Google → contacts)
-- is unaffected either way.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS google_contacts_sync_categories JSONB DEFAULT '[]'::jsonb;
