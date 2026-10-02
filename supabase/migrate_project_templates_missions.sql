-- Modèles de projet : répartition des missions MOE.
--
-- `default_missions` a la forme de `contrats_moe.missions_list`
-- (id, name, pct, incluse, category) : un contrat MOE la reprend telle quelle,
-- une proposition la convertit en répartition d'honoraires. jsonb, donc aucune
-- table supplémentaire.

ALTER TABLE project_templates ADD COLUMN IF NOT EXISTS default_missions JSONB NOT NULL DEFAULT '[]'::jsonb;
