-- Deux modes de saisie d'une situation de travaux (src/lib/situationDetaillee.ts) :
-- 'simple' : le cumul HT se saisit directement (montant_presente_ht) ;
-- 'detaille' : un avancement cumulé se saisit sur chaque ligne du DPGF du lot,
-- figée dans avancement_lignes (désignation, quantité, prix, %), et le serveur
-- en déduit montant_presente_ht.
ALTER TABLE situations
  ADD COLUMN IF NOT EXISTS mode_saisie TEXT NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS avancement_lignes JSONB;

DO $$ BEGIN
  ALTER TABLE situations ADD CONSTRAINT situations_mode_saisie_check CHECK (mode_saisie IN ('simple', 'detaille'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
