-- ============================================================
-- ArchiOffice — Backfill : site_reports pour les agents existants
-- ============================================================
-- Le fix précédent (voir CLAUDE.md, « Réunion de chantier vs réunion
-- classique côté agents ») a ajouté la ressource 'site_reports' à
-- AGENT_RESOURCES et l'a posée dans AGENT_DEFAULT_ACTION_SCOPES pour
-- charge-projet/pilote-chantier — mais AGENT_DEFAULT_ACTION_SCOPES n'est lu
-- qu'à la création d'un agent depuis un template (voir
-- migrate_add_agent_autonomy.sql, section 2 : "on ne touche jamais à un
-- tableau non vide"). Un agent déjà créé avant ce changement garde donc son
-- action_scopes existant tel quel, sans 'site_reports' — c'est exactement ce
-- qui faisait qu'un agent déjà en service continuait de créer une réunion
-- classique ('meetings') en réponse à « réunion de chantier », alors même
-- que le code côté serveur savait déjà créer un compte-rendu de chantier :
-- la ressource n'était simplement jamais dans le périmètre autorisé de CET
-- agent précis, donc jamais proposée au modèle.
--
-- Backfill ciblé, pas un défaut générique : seul un agent qui avait déjà
-- 'meetings' dans son périmètre (donc déjà autorisé à créer des réunions)
-- gagne 'site_reports' à côté — un agent qui n'avait pas 'meetings' n'a pas
-- vocation à créer de réunion de chantier non plus, et rien ne le change ici.
UPDATE agents
   SET action_scopes = array_append(action_scopes, 'site_reports')
 WHERE 'meetings' = ANY (action_scopes)
   AND NOT ('site_reports' = ANY (action_scopes));
