-- ── Clés étrangères composites (id, tenant_id) : quatrième lot, infrastructure et messagerie ─
--
-- Issue #245, suite des trois premiers fichiers migrate_zz_tenant_composite_fks*.sql (appliqués en
-- production, sauf le troisième, en attente du déploiement du code qui l'accompagne). Même logique,
-- même bloc DO, avec UNE différence (voir plus bas) ; la liste `v_parents` change. Lire l'en-tête du
-- premier fichier pour le principe, les règles de suppression reprises et les cas ignorés.
--
-- Parents de ce lot (21) : agents, conversations, custom_references, email_connections,
-- agent_conversations, agent_missions, agent_recurring_tasks, agent_schedules, articles_type,
-- calendar_calendars, calendar_connections, consultation_depot_invites, document_templates,
-- external_storage_connections, feed_posts, inspiration_boards, inspiration_items, rag_documents,
-- support_tickets, tender_rss_sources, webhooks.
--
-- Mesuré en production avant d'écrire ce fichier (lecture seule) : 21 parents, 36 clés simples, types
-- compatibles, `tenant_id` toujours renseigné, 0 ligne qui croise deux cabinets. La plus grosse table
-- enfant (rag_chunks) compte 28 lignes : la relecture de validation est négligeable.
--
-- Vérifié dans le code qu'aucun flux légitime ne croise deux cabinets sur ces liens : la réponse d'un
-- administrateur de la plateforme à un ticket reprend le cabinet du ticket (adminSupport.ts), la
-- duplication d'un modèle lit sa source avec tenantScopedFrom, les segments RAG reprennent le cabinet de
-- leur document, les correspondances RSS celui de leur source, les connexions de messagerie sont lues
-- par cabinet.
--
-- DIFFÉRENCE avec les lots précédents : un `RESTRICT` ENTRE DEUX TABLES (agent_missions.coordinator_agent_id
-- vers agents) devient `NO ACTION DEFERRABLE INITIALLY IMMEDIATE` au lieu de `RESTRICT`. Un RESTRICT n'est pas
-- différable : la mise à niveau d'un poste local (server/localCloudUpgrade.ts), qui réécrit `tenant_id`
-- table par table, échouerait quel que soit l'ordre des réécritures (parent d'abord : l'enfant le référence
-- encore ; enfant d'abord : son parent n'existe pas encore). Hors transaction différée, la suppression d'un
-- parent encore référencé est refusée sur-le-champ, exactement comme avec RESTRICT. Un lien AUTO-RÉFÉRENT en
-- RESTRICT (marches_entreprises, deuxième lot) reste un vrai RESTRICT : parent et enfant sont réécrits dans la
-- même instruction.
--
-- Limite connue sur un poste local NEUF : voir migrate_zz_tenant_composite_fks.sql.

DO $$
DECLARE
  v_parents   text[] := ARRAY['agents', 'conversations', 'custom_references', 'email_connections', 'agent_conversations', 'agent_missions', 'agent_recurring_tasks', 'agent_schedules', 'articles_type', 'calendar_calendars', 'calendar_connections', 'consultation_depot_invites', 'document_templates', 'external_storage_connections', 'feed_posts', 'inspiration_boards', 'inspiration_items', 'rag_documents', 'support_tickets', 'tender_rss_sources', 'webhooks'];
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
    RAISE NOTICE 'migrate_zz_tenant_composite_fks_4 : PostgreSQL < 15, migration ignorée (SET NULL (colonne) indisponible).';
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
        -- RESTRICT n'est pas différable : gardé pour un lien AUTO-RÉFÉRENT (parent et enfant sont réécrits dans la
        -- même instruction), mais entre deux tables il ferait échouer la mise à niveau d'un poste local, quel que soit
        -- l'ordre des réécritures. Il devient alors NO ACTION différable, refusé aussi sur-le-champ hors transaction différée.
        WHEN 'r' THEN CASE WHEN r.child_oid = format('public.%I', v_parent)::regclass THEN 'RESTRICT' ELSE 'NO ACTION' END
        ELSE 'NO ACTION'
      END;
      v_deferral := CASE WHEN v_action = 'RESTRICT' THEN '' ELSE ' DEFERRABLE INITIALLY IMMEDIATE' END;

      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I, tenant_id) REFERENCES public.%I (id, tenant_id) ON DELETE %s%s',
        r.child, v_new_name, r.child_col, v_parent, v_action, v_deferral);
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.old_name);
      v_converted := v_converted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'migrate_zz_tenant_composite_fks_4 : % clé(s) composite(s) posée(s), % ignorée(s).', v_converted, v_skipped;
END $$;
