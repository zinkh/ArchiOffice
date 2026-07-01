-- Chorus Pro integration: PISTE OAuth2 + technical account credentials, stored per tenant in settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS chorus_pro_piste_client_id TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS chorus_pro_piste_client_secret TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS chorus_pro_technical_login TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS chorus_pro_technical_password TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS chorus_pro_sandbox BOOLEAN DEFAULT true;

-- Track Chorus Pro submission + the B2G-specific fields required to submit a facture
-- (SIRET du destinataire public, code du service exécutant, numéro d'engagement/marché)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS chorus_pro_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS chorus_pro_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_siret TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_service_code TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS engagement_number TEXT;
