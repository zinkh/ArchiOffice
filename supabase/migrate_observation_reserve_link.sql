-- Lien entre une observation de la DET et la réserve de l'AOR qui la reprend.
-- À la réception, une observation encore à lever devient une réserve de l'OPR
-- (table `reserves`) : l'observation reste en place (l'historique des comptes-
-- rendus ne change pas) et pointe vers sa réserve. Colonne facultative, sans
-- effet tant qu'aucune observation n'est reprise ; si la réserve est supprimée,
-- le lien retombe à NULL et l'observation redevient reprenable.
ALTER TABLE observations ADD COLUMN IF NOT EXISTS reserve_id TEXT REFERENCES reserves(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_observations_reserve ON observations(reserve_id) WHERE reserve_id IS NOT NULL;
