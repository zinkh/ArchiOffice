-- Odoo integration: credentials stored per tenant in settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS odoo_url TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS odoo_db TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS odoo_username TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS odoo_api_key TEXT;

-- Track Odoo record IDs per entity for push (update vs create) logic
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE projects  ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE invoices  ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS odoo_id INTEGER;
