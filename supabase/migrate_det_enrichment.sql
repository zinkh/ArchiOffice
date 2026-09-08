-- Fusion du module DET : enrichit observations/site_reports des champs utiles
-- du prototype src/pages/DET.tsx (jamais monté, adossé à det_data, jamais
-- alimentée) avant sa suppression complète — voir CLAUDE.md, section
-- "Bâtiments, phases, localisation et offres DPGF" pour le contexte des
-- autres registres partagés du même type. det_data ne contient aucune
-- donnée réelle : rien à migrer, la table est droppée directement.

ALTER TABLE observations ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'observation';
ALTER TABLE observations ADD COLUMN IF NOT EXISTS urgence TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE observations ADD COLUMN IF NOT EXISTS photos TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS attendance JSONB DEFAULT '[]';
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'brouillon';
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS decisions JSONB DEFAULT '[]';

DROP TABLE IF EXISTS det_data;
