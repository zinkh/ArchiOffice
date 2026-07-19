-- ============================================================
-- ArchiOffice — Migration : Actions d'écriture pour les Agents IA
-- ============================================================
-- Les agents ne pouvaient jusqu'ici que lire les données du cabinet
-- (context_scopes). Cette colonne leur donne, agent par agent et sur
-- décision explicite de l'architecte, la permission de créer des
-- données (contacts, devis) via des function calls Gemini.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS action_scopes TEXT[] NOT NULL DEFAULT '{}';
