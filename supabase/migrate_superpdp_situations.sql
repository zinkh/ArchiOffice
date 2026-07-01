-- Super PDP for "situations" (factures de travaux, marchés privés). Chorus Pro
-- is reserved for marchés publics (see migrate_chorus_pro_situations*.sql) —
-- for private markets, the entreprise's facture is retrieved/linked and the
-- MOE's état d'acompte is deposited as a complementary attachment via
-- Super PDP instead, mirroring the same workflow.
ALTER TABLE situations ADD COLUMN IF NOT EXISTS superpdp_id INTEGER;
ALTER TABLE situations ADD COLUMN IF NOT EXISTS superpdp_status TEXT;
