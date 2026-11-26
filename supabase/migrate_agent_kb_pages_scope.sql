-- Migration : la base de données du cabinet (kb_pages) devient un périmètre d'écriture de TOUS les agents
--
-- La ressource `kb_pages` (pages et notes du cabinet, packages/archioffice-agents/src/types.ts) s'ajoute à
-- `action_scopes` de chaque agent, modèles système et agents déjà instanciés : choix du cabinet, « activé
-- pour tous les agents ». Elle sert à créer et modifier des pages ; supprimer met la page à la corbeille
-- (restaurable), la suppression définitive reste réservée aux rôles admin, manager et pm et hors agents.
-- Un cabinet qui ne la veut pas pour un agent la décoche depuis /agents/:id/edit.
-- Contrairement à migrate_add_agent_autonomy.sql, cette migration touche aussi les agents dont le périmètre
-- a été réglé à la main : elle ajoute une entrée, elle n'en retire ni n'en remplace aucune.
-- Idempotente : rejouée, elle ne change plus rien (AGENT_DEFAULT_ACTION_SCOPES porte la même règle pour
-- les agents que l'on active depuis un modèle).

UPDATE agents
   SET action_scopes = array_append(coalesce(action_scopes, ARRAY[]::text[]), 'kb_pages')
 WHERE NOT ('kb_pages' = ANY (coalesce(action_scopes, ARRAY[]::text[])));
