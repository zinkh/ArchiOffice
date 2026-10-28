-- PV des opérations préalables à la réception (OPR) : un PV par lot, en marché privé
-- (modèle simplifié, trois volets) comme en marché public (formulaires EXE4 à EXE9).
-- Additive : une ligne existante garde `regime` NULL et se comporte comme avant
-- (PV générique de l'affaire).

ALTER TABLE receptions
  ADD COLUMN IF NOT EXISTS marche_id TEXT,
  ADD COLUMN IF NOT EXISTS lot_id TEXT,
  ADD COLUMN IF NOT EXISTS regime TEXT,
  ADD COLUMN IF NOT EXISTS ccag_version TEXT,
  ADD COLUMN IF NOT EXISTS date_avis_achevement TEXT,
  ADD COLUMN IF NOT EXISTS date_achevement_annoncee TEXT,
  ADD COLUMN IF NOT EXISTS date_opr TEXT,
  ADD COLUMN IF NOT EXISTS presences JSONB,
  ADD COLUMN IF NOT EXISTS constats JSONB,
  ADD COLUMN IF NOT EXISTS proposition JSONB,
  ADD COLUMN IF NOT EXISTS decision JSONB,
  ADD COLUMN IF NOT EXISTS levee JSONB,
  ADD COLUMN IF NOT EXISTS carence JSONB,
  ADD COLUMN IF NOT EXISTS delais JSONB;

ALTER TABLE receptions DROP CONSTRAINT IF EXISTS receptions_regime_check;
ALTER TABLE receptions ADD CONSTRAINT receptions_regime_check
  CHECK (regime IS NULL OR regime IN ('prive', 'public'));
ALTER TABLE receptions DROP CONSTRAINT IF EXISTS receptions_ccag_version_check;
ALTER TABLE receptions ADD CONSTRAINT receptions_ccag_version_check
  CHECK (ccag_version IS NULL OR ccag_version IN ('2009', '2021'));

CREATE INDEX IF NOT EXISTS idx_receptions_tenant_marche ON receptions(tenant_id, marche_id);
