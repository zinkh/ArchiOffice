-- SuperPDP integration: OAuth2 credentials stored per tenant in settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS superpdp_client_id TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS superpdp_client_secret TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS superpdp_sandbox BOOLEAN DEFAULT true;

-- Track SuperPDP invoice IDs for status polling
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superpdp_id INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superpdp_status TEXT;
