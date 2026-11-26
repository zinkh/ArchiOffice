-- Propositions : arrondi des honoraires, remise commerciale, périmètre de mission (PC seul).
--
-- fee_gross        : honoraires bruts avant remise (après périmètre et arrondi). `amount` reste
--                    le net HT, lu par la MAF, les factures et les exports.
-- fee_rounding     : 'none' | 'euro' | 'ten' | 'hundred'. NULL = aucun arrondi.
-- discount_mode    : 'percent' | 'amount'. NULL = pas de remise.
-- discount_value   : pourcentage ou montant HT de la remise.
-- mission_scope    : 'complete' | 'pc'. NULL = mission complète.
-- scope_share_pct  : pour un PC seul, part (%) des honoraires de la mission complète.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS fee_gross NUMERIC,
  ADD COLUMN IF NOT EXISTS fee_rounding TEXT,
  ADD COLUMN IF NOT EXISTS discount_mode TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC,
  ADD COLUMN IF NOT EXISTS mission_scope TEXT,
  ADD COLUMN IF NOT EXISTS scope_share_pct NUMERIC;
