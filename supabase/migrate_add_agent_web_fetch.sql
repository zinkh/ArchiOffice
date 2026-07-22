-- ============================================================
-- ArchiOffice — Migration : Accès web (fetch_url) pour les Agents IA
-- ============================================================
-- Capacité distincte de action_scopes (qui ne couvre que les ressources
-- CRUD internes du cabinet) : autorise, agent par agent et sur décision
-- explicite de l'architecte, un outil de récupération de pages web
-- publiques. Off par défaut — un agent qui va chercher du contenu sur un
-- domaine arbitraire choisi par le modèle est un vecteur de risque
-- (SSRF, prompt injection via le contenu récupéré) distinct des actions
-- d'écriture internes, d'où une colonne et un toggle séparés plutôt
-- qu'une entrée de plus dans action_scopes.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS web_fetch_enabled BOOLEAN NOT NULL DEFAULT FALSE;
