-- Ragic integration: credentials stored per tenant in settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ragic_api_key TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ragic_account TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ragic_sheet_contacts TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ragic_sheet_projects TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ragic_sheet_invoices TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ragic_sheet_proposals TEXT;

-- Track Ragic record IDs so push knows whether to POST (create) or PUT (update)
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS ragic_id TEXT;
ALTER TABLE projects  ADD COLUMN IF NOT EXISTS ragic_id TEXT;
ALTER TABLE invoices  ADD COLUMN IF NOT EXISTS ragic_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS ragic_id TEXT;
