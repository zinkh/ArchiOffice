-- ============================================================
-- ArchiOffice — Migration : traçabilité du fournisseur IA
-- ============================================================
-- Étape 2 de l'intégration multi-fournisseurs. Une ligne de consommation ne
-- portait jusqu'ici que des tokens et un coût : tant qu'un seul modèle
-- tournait, le tarif était déductible. Avec Gemini, Claude et Mistral
-- sélectionnables, deux lignes de 1 000 tokens peuvent coûter €0,004 ou
-- €0,04 sans que rien ne permette de les distinguer après coup.

ALTER TABLE agent_token_usage
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model    TEXT;

COMMENT ON COLUMN agent_token_usage.provider IS
  'Fournisseur IA ayant traité l''appel : gemini, anthropic ou mistral.';
COMMENT ON COLUMN agent_token_usage.model IS
  'Identifiant exact du modèle appelé, par exemple gemini-3-flash-preview.';

-- Toutes les lignes antérieures ont tourné sur Gemini, seul fournisseur
-- disponible jusqu'ici : le fournisseur est donc rétro-renseigné avec
-- certitude. Le modèle ne l'est pas : les lignes les plus anciennes datent de
-- gemini-2.5-flash et rien ne permet de les séparer de celles de
-- gemini-3-flash-preview. Il reste NULL plutôt que d'inventer une valeur qui
-- fausserait une reconstitution de coûts.
UPDATE agent_token_usage SET provider = 'gemini' WHERE provider IS NULL;
