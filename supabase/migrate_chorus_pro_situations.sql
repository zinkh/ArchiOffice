-- Extend the Chorus Pro plugin to "factures travaux" (états d'acompte / situations
-- d'entreprises), in addition to the "factures maîtrise d'œuvre" already covered on
-- invoices (see migrate_chorus_pro.sql).

-- The invoicing party for a situation de travaux is the entreprise, not the
-- cabinet d'architecture — Chorus Pro needs its SIRET as "fournisseur".
ALTER TABLE marches_entreprises ADD COLUMN IF NOT EXISTS entreprise_siret TEXT;

ALTER TABLE situations ADD COLUMN IF NOT EXISTS chorus_pro_id TEXT;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS chorus_pro_status TEXT;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS buyer_siret TEXT;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS buyer_service_code TEXT;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS engagement_number TEXT;
