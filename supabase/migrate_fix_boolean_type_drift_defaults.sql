-- Complète migrate_fix_boolean_type_drift.sql, qui échouait en silence sur
-- tout poste Electron dont la base locale avait ces colonnes en INTEGER avec
-- un DEFAULT 0 : Postgres refuse « ALTER COLUMN ... TYPE BOOLEAN » tant que
-- l'ancien défaut entier est présent (« default for column "x" cannot be cast
-- automatically to type boolean »), et SET DEFAULT dans le même ALTER arrive
-- trop tard. Une erreur de migration sur un poste existant est avalée par
-- electron/pgBootstrap.cjs (la base reste utilisable) : le poste gardait donc
-- ses colonnes entières, et l'import initial du cloud échouait sur toute
-- table qui les porte (« invalid input syntax for type integer: "false" »),
-- ce qui entraînait, par clé étrangère, l'échec de toutes les tables
-- rattachées aux affaires.
--
-- Ici, colonne par colonne : on retire le défaut, on change le type, on
-- repose le défaut. Idempotent : une colonne déjà booléenne, une table ou
-- une colonne absente ne sont jamais touchées. Le cast passe par le texte
-- (0/1, 'true'/'false', '' deviennent false/true/NULL) et NULL reste NULL.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT t.table_name, t.column_name
    FROM information_schema.columns t
    JOIN (VALUES
      ('projects',   'is_public_client'),
      ('projects',   'is_entreprise'),
      ('projects',   'is_complete_mission'),
      ('projects',   'is_chantier'),
      ('proposals',  'is_entreprise'),
      ('tenders',    'mandatory_visit'),
      ('tenders',    'archived'),
      ('milestones', 'completed'),
      ('receptions', 'has_reserves')
    ) AS w(table_name, column_name)
      ON w.table_name = t.table_name AND w.column_name = t.column_name
    WHERE t.table_schema = 'public'
      AND t.data_type <> 'boolean'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT', c.table_name, c.column_name);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE BOOLEAN USING NULLIF(%I::text, '''')::boolean',
      c.table_name, c.column_name, c.column_name
    );
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT false', c.table_name, c.column_name);
  END LOOP;
END
$$;
