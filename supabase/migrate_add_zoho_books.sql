-- Add zoho_books_org_id column to settings table for Zoho Books integration
ALTER TABLE settings ADD COLUMN IF NOT EXISTS zoho_books_org_id TEXT;
