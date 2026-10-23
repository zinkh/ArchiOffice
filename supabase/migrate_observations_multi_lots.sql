-- Observation adressée à plusieurs lots, ou à tous (TCE, « Tout corps d'état »).
--   lot_id  : le lot unique, ou le premier des lots visés (nul pour une observation TCE) ;
--   lot_ids : tous les lots visés quand il y en a plusieurs (vide = un seul lot, cas historique) ;
--   tce     : vrai quand l'observation vise tous les lots.
-- Aucune donnée existante ne change : une observation reste rattachée à son lot par lot_id.
ALTER TABLE observations ADD COLUMN IF NOT EXISTS lot_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS tce BOOLEAN NOT NULL DEFAULT false;
