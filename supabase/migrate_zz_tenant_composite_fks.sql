-- ── Clés étrangères composites (id, tenant_id) : PostgreSQL, dernière ligne de défense ──
--
-- Issue #245. Une clé étrangère simple (`project_id REFERENCES projects(id)`) garantit
-- seulement que l'identifiant EXISTE, pas qu'il appartient au même cabinet que la ligne
-- qui le référence. Les routes serveur contrôlent désormais l'appartenance
-- (server/assertTenantEntity.ts), mais une route qui l'oublie, un script ou un appel
-- direct avec la clé service-role pouvait encore rattacher une ligne du cabinet A à une
-- ressource du cabinet B.
--
-- Cette migration remplace, pour les liens qui visent `projects`, `contacts` et
-- `contrats_moe`, la clé simple par une clé composite
-- `(colonne, tenant_id) REFERENCES parent (id, tenant_id)` : la base refuse alors toute
-- ligne dont le parent est d'un autre cabinet.
--
-- Mesuré en production avant d'écrire ce fichier : 154 clés simples entre tables à
-- `tenant_id`, 0 ligne qui croise deux cabinets. Rien à nettoyer.
--
-- Comportement conservé :
--   - la règle de suppression de chaque clé d'origine est reprise : CASCADE reste CASCADE,
--     NO ACTION reste NO ACTION, et SET NULL devient `SET NULL (colonne)` : seule la
--     colonne de liaison est mise à NULL, jamais `tenant_id` (PostgreSQL 15 et plus).
--   - une colonne de liaison NULL reste permise (MATCH SIMPLE) : « pas de contact » n'est
--     pas une référence à contrôler.
--   - les jointures PostgREST `.select('*, projects(name)')` continuent de fonctionner : la
--     clé simple est SUPPRIMÉE après la pose de la composite, il n'y a donc jamais deux
--     relations entre les mêmes tables (ce qui rendrait les jointures ambiguës).
--
-- Clés posées `DEFERRABLE INITIALLY IMMEDIATE` : vérifiées à chaque instruction comme
-- n'importe quelle clé, sauf dans la transaction de la mise à niveau d'un poste local vers
-- le cloud (server/localCloudUpgrade.ts), qui réécrit `tenant_id` table par table dans un
-- ordre quelconque et y demande `SET CONSTRAINTS ALL DEFERRED`.
--
-- Découverte dynamique plutôt qu'une liste figée : toute clé simple d'une table à
-- `tenant_id` vers l'un des parents ci-dessous est convertie, y compris celles de tables
-- créées par une migration voisine. Ce fichier est nommé pour passer EN DERNIER dans
-- l'ordre alphabétique des migrations (electron/applySchema.cjs) ; le relancer plus tard
-- convertit celles qui seraient apparues depuis. Pour étendre à un autre parent, l'ajouter
-- à `v_parents`.
--
-- Limite connue sur un poste local NEUF (electron/applySchema.cjs) : chaque fichier n'y est
-- appliqué qu'une fois, et une instruction qui échoue au premier passage (référence vers
-- une table créée par un fichier postérieur dans l'ordre alphabétique) n'est rejouée
-- qu'APRÈS tous les fichiers, donc après celui-ci. Aujourd'hui cela concerne une seule clé :
-- `avenants_moe.contrat_moe_id` (migrate_avenants_moe.sql précède migrate_contrats_moe.sql),
-- qui y garde sa clé simple (49 clés composites au lieu de 50). La production n'est pas
-- concernée (migrations appliquées dans l'ordre) et le contrôle de la route reste en place.
-- Pour la convertir sur un poste local, relancer ce bloc DO ou le rejouer dans une
-- prochaine migration.
--
-- Prudence : une table est IGNORÉE avec un avertissement, jamais en échec, si
--   - une de ses lignes croise déjà deux cabinets,
--   - son `tenant_id` est nullable ET contient des NULL,
--   - le type de `tenant_id` ou de la colonne de liaison diffère de celui du parent
--     (`project_members.tenant_id` est du TEXTE alors que `projects.tenant_id` est un UUID :
--     elle garde sa clé simple).
-- Sur PostgreSQL < 15 la migration ne fait rien (pas de `SET NULL (colonne)`).
--
-- Retour arrière, pour une clé : `ALTER TABLE t DROP CONSTRAINT <t>_<col>_tenant_fkey;`
-- puis `ALTER TABLE t ADD CONSTRAINT <t>_<col>_fkey FOREIGN KEY (<col>) REFERENCES
-- <parent>(id) ON DELETE <même règle>;`. Les `UNIQUE (id, tenant_id)` des parents peuvent
-- rester sans effet de bord.

DO $$
DECLARE
  v_parents   text[] := ARRAY['projects', 'contacts', 'contrats_moe'];
  v_parent    text;
  r           record;
  v_action    text;
  v_deferral  text;
  v_new_name  text;
  v_count     bigint;
  v_converted int := 0;
  v_skipped   int := 0;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE NOTICE 'migrate_zz_tenant_composite_fks : PostgreSQL < 15, migration ignorée (SET NULL (colonne) indisponible).';
    RETURN;
  END IF;

  FOREACH v_parent IN ARRAY v_parents LOOP
    IF to_regclass(format('public.%I', v_parent)) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = format('public.%I', v_parent)::regclass AND attname = 'tenant_id' AND NOT attisdropped
    ) THEN CONTINUE; END IF;

    -- Une clé composite doit référencer un ensemble de colonnes UNIQUE.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = format('public.%I', v_parent)::regclass AND conname = v_parent || '_id_tenant_id_key'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, tenant_id)', v_parent, v_parent || '_id_tenant_id_key');
    END IF;

    FOR r IN
      SELECT c.conname::text                                  AS old_name,
             c.conrelid                                       AS child_oid,
             c.conrelid::regclass::text                       AS child,
             (SELECT relname::text FROM pg_class WHERE oid = c.conrelid) AS child_name,
             ca.attname::text                                 AS child_col,
             c.confdeltype                                    AS del,
             ct.attnotnull                                    AS tenant_not_null
        FROM pg_constraint c
        JOIN pg_attribute ca ON ca.attrelid = c.conrelid  AND ca.attnum = c.conkey[1]  AND NOT ca.attisdropped
        JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1] AND pa.attname = 'id'
        JOIN pg_attribute ct ON ct.attrelid = c.conrelid  AND ct.attname = 'tenant_id' AND NOT ct.attisdropped
        JOIN pg_attribute pt ON pt.attrelid = c.confrelid AND pt.attname = 'tenant_id' AND NOT pt.attisdropped
       WHERE c.contype = 'f'
         AND c.connamespace = 'public'::regnamespace
         AND c.confrelid = format('public.%I', v_parent)::regclass
         AND array_length(c.conkey, 1) = 1
         AND ca.atttypid = pa.atttypid      -- colonne de liaison et id du parent : même type
         AND ct.atttypid = pt.atttypid      -- tenant_id des deux côtés : même type
       ORDER BY 3
    LOOP
      v_new_name := left(r.child_name || '_' || r.child_col, 52) || '_tenant_fkey';

      -- Déjà convertie : ne reste qu'à retirer la clé simple si elle traîne encore.
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.child_oid AND conname = v_new_name) THEN
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.old_name);
        CONTINUE;
      END IF;

      -- Aucune ligne existante ne doit croiser deux cabinets.
      EXECUTE format(
        'SELECT count(*) FROM %s ch JOIN public.%I pa ON pa.id = ch.%I WHERE ch.tenant_id IS DISTINCT FROM pa.tenant_id',
        r.child, v_parent, r.child_col) INTO v_count;
      IF v_count > 0 THEN
        RAISE WARNING 'clé composite ignorée pour %.% : % ligne(s) pointent vers un autre cabinet, à corriger puis relancer.',
          r.child, r.child_col, v_count;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- tenant_id NULL échapperait au contrôle (MATCH SIMPLE) : on le rend obligatoire,
      -- sauf si des lignes sans cabinet existent.
      IF NOT r.tenant_not_null THEN
        EXECUTE format('SELECT count(*) FROM %s WHERE tenant_id IS NULL', r.child) INTO v_count;
        IF v_count > 0 THEN
          RAISE WARNING 'clé composite ignorée pour %.% : % ligne(s) sans tenant_id.', r.child, r.child_col, v_count;
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
        EXECUTE format('ALTER TABLE %s ALTER COLUMN tenant_id SET NOT NULL', r.child);
      END IF;

      v_action := CASE r.del
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN format('SET NULL (%I)', r.child_col)
        WHEN 'd' THEN format('SET DEFAULT (%I)', r.child_col)
        WHEN 'r' THEN 'RESTRICT'
        ELSE 'NO ACTION'
      END;
      -- RESTRICT n'est pas différable.
      v_deferral := CASE WHEN r.del = 'r' THEN '' ELSE ' DEFERRABLE INITIALLY IMMEDIATE' END;

      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I, tenant_id) REFERENCES public.%I (id, tenant_id) ON DELETE %s%s',
        r.child, v_new_name, r.child_col, v_parent, v_action, v_deferral);
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.old_name);
      v_converted := v_converted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'migrate_zz_tenant_composite_fks : % clé(s) composite(s) posée(s), % ignorée(s).', v_converted, v_skipped;
END $$;
