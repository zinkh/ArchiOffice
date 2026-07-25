-- Classify visas by lot (same contact_id/contact_name-bearing project lot
-- used elsewhere), alongside the document upload the visa now supports.
ALTER TABLE visas ADD COLUMN IF NOT EXISTS lot_id TEXT;
