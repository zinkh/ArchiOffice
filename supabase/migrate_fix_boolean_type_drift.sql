-- server/initialImport.ts (le premier import complet d'un poste Electron
-- relié au cloud, voir CLAUDE.md « Facturation… » — non, plutôt « import
-- initial ») échouait sur plusieurs tables avec « invalid input syntax for
-- type integer: "false" ». Cause : plusieurs colonnes booléennes ont été
-- ajoutées ou corrigées directement sur le projet Supabase de production
-- (hors de toute migration versionnée ici) alors que schema.sql, qui sert
-- à construire la base Postgres embarquée de CHAQUE poste Electron, les
-- déclare encore en INTEGER (voire TEXT) — un projet qui existe réellement
-- sur le cloud ne peut alors plus jamais être importé localement : PostgREST
-- reçoit un JSON `false`/`true` et tente de l'écrire dans une colonne entière
-- ou texte, ce qui échoue (INTEGER) ou stocke silencieusement la chaîne
-- "false" — une valeur JavaScript VRAIE (`Boolean("false") === true`), donc
-- un bug de lecture aussi trompeur que l'échec d'écriture.
--
-- Vérifié directement contre le schéma de production (Supabase MCP,
-- information_schema.columns) avant d'écrire cette migration — même
-- démarche que supabase/migrate_add_sync_infra.sql pour SYNC_TABLES.
--
-- USING col::boolean : Postgres caste explicitement un entier (0 → false,
-- non nul → true) ou un texte 'true'/'false' en boolean, et préserve NULL.
--
-- is_complete_mission/is_chantier : NULLIF(col, '') suffisait tant que la
-- colonne était encore TEXT (son type d'origine), mais schema.sql la déclare
-- désormais BOOLEAN dès la création (voir plus haut) — sur un poste jamais
-- lancé avant ce correctif, cette même migration s'exécute alors contre une
-- colonne DÉJÀ booléenne, et NULLIF(boolean, '') tente de caster le littéral
-- texte '' en boolean pour la comparaison, ce qui échoue toujours
-- (« invalid input syntax for type boolean: "" », constaté en pratique sur
-- une installation neuve). ::text avant le NULLIF fonctionne dans les deux
-- cas : sur une colonne TEXT c'est un cast identité, et sur une colonne déjà
-- BOOLEAN elle repasse par 'true'/'false' en texte puis reboolean --
-- l'aller-retour préserve la valeur (et NULL reste NULL dans les deux cas).
ALTER TABLE projects
  ALTER COLUMN is_public_client TYPE BOOLEAN USING is_public_client::boolean,
  ALTER COLUMN is_public_client SET DEFAULT false,
  ALTER COLUMN is_entreprise TYPE BOOLEAN USING is_entreprise::boolean,
  ALTER COLUMN is_entreprise SET DEFAULT false,
  ALTER COLUMN is_complete_mission TYPE BOOLEAN USING NULLIF(is_complete_mission::text, '')::boolean,
  ALTER COLUMN is_complete_mission SET DEFAULT false,
  ALTER COLUMN is_chantier TYPE BOOLEAN USING NULLIF(is_chantier::text, '')::boolean,
  ALTER COLUMN is_chantier SET DEFAULT false;

ALTER TABLE proposals
  ALTER COLUMN is_entreprise TYPE BOOLEAN USING is_entreprise::boolean,
  ALTER COLUMN is_entreprise SET DEFAULT false;

ALTER TABLE tenders
  ALTER COLUMN mandatory_visit TYPE BOOLEAN USING mandatory_visit::boolean,
  ALTER COLUMN mandatory_visit SET DEFAULT false,
  ALTER COLUMN archived TYPE BOOLEAN USING archived::boolean,
  ALTER COLUMN archived SET DEFAULT false;

ALTER TABLE milestones
  ALTER COLUMN completed TYPE BOOLEAN USING completed::boolean,
  ALTER COLUMN completed SET DEFAULT false;

ALTER TABLE receptions
  ALTER COLUMN has_reserves TYPE BOOLEAN USING has_reserves::boolean,
  ALTER COLUMN has_reserves SET DEFAULT false;
