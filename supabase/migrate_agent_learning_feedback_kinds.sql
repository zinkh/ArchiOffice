-- ── Apprentissage des agents : retours de l'utilisateur (note, amélioration) ──
--
-- Les boutons de retour du chat (correction, note, amélioration) déposent une
-- proposition dans agent_learning_suggestions comme l'outil
-- suggerer_amelioration, sous deux natures de plus : 'note' et 'improvement'.
--
-- Une instance qui a déjà joué migrate_agent_learning.sql avant cet
-- élargissement porte l'ancienne contrainte (correction, missing_capability,
-- knowledge_note) : CREATE TABLE IF NOT EXISTS ne la modifie pas. Cette
-- migration la remplace, et ne fait rien de plus sur une instance neuve.
-- Rejouable : DROP IF EXISTS puis ADD.
DO $$
BEGIN
  IF to_regclass('public.agent_learning_suggestions') IS NOT NULL THEN
    ALTER TABLE agent_learning_suggestions DROP CONSTRAINT IF EXISTS agent_learning_suggestions_kind_check;
    ALTER TABLE agent_learning_suggestions ADD CONSTRAINT agent_learning_suggestions_kind_check
      CHECK (kind IN ('correction', 'note', 'improvement', 'missing_capability', 'knowledge_note'));
  END IF;
END $$;
