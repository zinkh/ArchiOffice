-- ── Idempotence de la remontée des prix ─────────────────────────────────────
-- Les observations de prix ne sont plus seulement saisies à la main : elles
-- sont désormais déversées automatiquement depuis les offres reçues sur un BPU
-- et depuis les envois en lot d'un DPGF vers la bibliothèque.
--
-- Or ces deux sources se rejouent : une offre est réimportée après correction,
-- un DPGF est renvoyé à la bibliothèque à chaque révision. Sans clé de source,
-- chaque rejeu ajouterait un doublon, et la médiane d'un article se mettrait à
-- refléter le nombre d'imports plutôt que le nombre d'entreprises consultées.
--
-- `source_ref` est cette clé : une chaîne stable qui désigne l'origine exacte
-- d'une observation, par exemple « bpu:<offreId>:<ligneId> ». L'index unique
-- permet un upsert, donc un réimport CORRIGE le prix au lieu de l'empiler.
--
-- L'index est volontairement TOTAL et non partiel. Un index partiel
-- (`WHERE source_ref IS NOT NULL`) aurait semblé plus propre, mais PostgREST
-- n'émet pas le prédicat de l'index dans son `ON CONFLICT`, et Postgres refuse
-- alors d'inférer une contrainte partielle : l'upsert échouerait avec « no
-- unique or exclusion constraint matching the ON CONFLICT specification ».
-- Le prédicat est inutile de toute façon : Postgres tient les NULL pour
-- distincts dans un index unique, donc les observations saisies à la main
-- (`source_ref` à NULL) restent libres de se répéter, ce qui est le
-- comportement voulu pour une saisie.
ALTER TABLE article_prix_observations ADD COLUMN IF NOT EXISTS source_ref TEXT;

DROP INDEX IF EXISTS uniq_prix_obs_source_ref;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prix_obs_source_ref
  ON article_prix_observations(tenant_id, source_ref);
