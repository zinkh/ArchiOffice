-- ── Clés étrangères composites (id, tenant_id) : deuxième lot de parents ──────────────────
--
-- Issue #245, suite de migrate_zz_tenant_composite_fks.sql (projects, contacts, contrats_moe,
-- appliquée en production le 2026-11-11 sous `tenant_composite_fks`). MÊME logique, MÊME bloc
-- DO ; seule la liste `v_parents` change. Lire l'en-tête de ce premier fichier pour le principe,
-- les règles de suppression reprises, le caractère différable des clés et les cas ignorés.
--
-- Ce fichier est séparé du premier et non une édition de celui-ci : un poste local n'applique
-- chaque fichier qu'une fois (electron/applySchema.cjs), et la production a déjà reçu le
-- premier. Il se trie APRÈS lui (« . » < « _ » dans l'ordre alphabétique).
--
-- Parents de ce lot (17) : les tables métier que les routes référencent depuis le corps d'une
-- requête, nommées par l'issue : proposals, tenders, marches_entreprises, documents, meetings,
-- et invoices, situations, reserves, receptions, plans, tasks, dpgfs, dpgf_items, cctps,
-- project_lots, project_shares, project_share_comments.
--
-- Mesuré en production avant d'écrire ce fichier (lecture seule) : 40 parents restants,
-- 84 clés simples, toutes de types compatibles, 0 ligne qui croise deux cabinets.
-- Ce lot en poserait 46.
--
-- EXCLU VOLONTAIREMENT : `site_reports`. `observations.ts` joint cette table avec des indices
-- de colonne (`site_reports!created_report_id(...)`, `site_reports!resolved_report_id(...)`), et
-- PostgREST n'accepte un indice de colonne que pour une clé à UNE seule colonne : sur une clé
-- composite la jointure échouerait (PGRST200). Une jointure SANS indice (`projects(name)`) reste
-- valable. tests/compositeFkEmbedHints.test.ts interdit l'indice de colonne vers tout parent
-- converti ; pour convertir `site_reports`, réécrire d'abord ces deux jointures.
--
-- Hors de ce lot, pour une suite : les tables d'infrastructure et de messagerie (agents,
-- conversations, email_connections, calendar_*, external_storage_connections, support_tickets,
-- webhooks, rag_documents, feed_posts, inspiration_*, custom_references, articles_type,
-- document_templates, tender_rss_sources...). Même mécanisme, à ajouter à `v_parents`.
--
-- Limite connue sur un poste local NEUF : les instructions qui échouent au premier passage de
-- applyLocalSchema sont rejouées après tous les fichiers, donc après celui-ci ; les clés qu'elles
-- créent gardent leur clé simple (aucune incidence en production).

DO $$
DECLARE
  v_parents   text[] := ARRAY['proposals', 'tenders', 'marches_entreprises', 'documents', 'meetings', 'invoices', 'situations', 'reserves', 'receptions', 'plans', 'tasks', 'dpgfs', 'dpgf_items', 'cctps', 'project_lots', 'project_shares', 'project_share_comments'];
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
    RAISE NOTICE 'migrate_zz_tenant_composite_fks_2 : PostgreSQL < 15, migration ignorée (SET NULL (colonne) indisponible).';
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

  RAISE NOTICE 'migrate_zz_tenant_composite_fks_2 : % clé(s) composite(s) posée(s), % ignorée(s).', v_converted, v_skipped;
END $$;
