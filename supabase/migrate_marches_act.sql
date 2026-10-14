-- Marchés de travaux constitués depuis l'ACT (phase « Marchés »).
-- Un marché naît de l'attribution d'un lot à une entreprise : il garde le lien
-- avec le lot et l'entreprise de la consultation, l'offre retenue figée au
-- moment de la constitution, et le suivi de signature (papier ou électronique).
-- Les marchés saisis à la main (sans consultation) restent valides : toutes les
-- colonnes ajoutées sont facultatives.
ALTER TABLE marches_entreprises
  ADD COLUMN IF NOT EXISTS act_lot_id TEXT,
  ADD COLUMN IF NOT EXISTS act_entreprise_id TEXT,
  ADD COLUMN IF NOT EXISTS contact_id TEXT,
  ADD COLUMN IF NOT EXISTS offre_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS statut_signature TEXT NOT NULL DEFAULT 'a_constituer',
  ADD COLUMN IF NOT EXISTS mode_signature TEXT,
  ADD COLUMN IF NOT EXISTS date_signature DATE,
  ADD COLUMN IF NOT EXISTS acte_signe_document_id TEXT;

ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_statut_signature_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_statut_signature_check
  CHECK (statut_signature IN ('a_constituer', 'a_signer', 'signe'));
ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_mode_signature_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_mode_signature_check
  CHECK (mode_signature IS NULL OR mode_signature IN ('papier', 'electronique'));

-- Un lot attribué ne donne qu'un marché par affaire. Index TOTAL, pas partiel :
-- PostgREST n'émet pas le prédicat dans son ON CONFLICT, et Postgres tient les
-- NULL pour distincts, donc les marchés saisis à la main restent libres.
CREATE UNIQUE INDEX IF NOT EXISTS marches_entreprises_act_lot
  ON marches_entreprises(project_id, act_lot_id);
