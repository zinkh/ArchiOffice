-- PV d'OPR : signature (verrou du contenu) et référence unique par cabinet.
-- Additive. L'index unique est partiel : seuls les PV d'OPR (régime renseigné) portent
-- une référence attribuée par le serveur (OPR-AAAA-NNN) ; les PV génériques, dont
-- la référence est saisie à la main, restent libres de se répéter.

ALTER TABLE receptions
  ADD COLUMN IF NOT EXISTS signed_at TEXT,
  ADD COLUMN IF NOT EXISTS signed_mode TEXT,
  ADD COLUMN IF NOT EXISTS signed_document_id TEXT;

ALTER TABLE receptions DROP CONSTRAINT IF EXISTS receptions_signed_mode_check;
ALTER TABLE receptions ADD CONSTRAINT receptions_signed_mode_check
  CHECK (signed_mode IS NULL OR signed_mode IN ('papier', 'electronique'));

CREATE UNIQUE INDEX IF NOT EXISTS receptions_opr_reference
  ON receptions(tenant_id, reference_pv)
  WHERE regime IS NOT NULL AND reference_pv IS NOT NULL;
