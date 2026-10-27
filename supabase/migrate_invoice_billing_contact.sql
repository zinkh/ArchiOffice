-- Migration: contact destinataire de la facture (comptabilité, finances...)
--
-- Le Maître d'Ouvrage d'une facture est celui de l'opération (invoices.client_id,
-- voir migrate_invoice_client_link.sql). Il arrive que la facture doive partir
-- chez un autre interlocuteur du maître d'ouvrage (service comptabilité,
-- direction financière...) : billing_contact_id le désigne, sans changer
-- l'identité légale du client portée par la facture. NULL = envoi au Maître
-- d'Ouvrage lui-même.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_billing_contact_id ON invoices(billing_contact_id);
