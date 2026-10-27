-- Migration : fusion de contacts
--
-- merge_contacts(cabinet, fiche conservée, doublons, correctifs) rattache à la fiche
-- conservée TOUT ce qui pointait vers les doublons (colonnes de clé étrangère, liens
-- polymorphes, références stockées en jsonb), reprend les identifiants de synchro
-- externe (Odoo, Ragic, Google) quand la fiche conservée n'en a pas, applique les
-- valeurs choisies à l'écran, supprime les doublons et journalise la fusion. Une
-- seule transaction : en cas d'erreur, rien n'est modifié.
--
-- Tolérante : une table ou une colonne absente (instance non migrée) est ignorée au
-- lieu de faire échouer toute la fusion. Réservée au rôle serveur, comme
-- next_document_number : un compte connecté ne peut pas la lancer par l'API REST.
--
-- Une NOUVELLE colonne qui référence un contact doit être ajoutée à la liste
-- `v_refs` ci-dessous (tests/contactMergeReferences.test.ts le vérifie).

CREATE TABLE IF NOT EXISTS contact_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  primary_id TEXT NOT NULL,
  primary_name TEXT,
  merged JSONB NOT NULL DEFAULT '[]'::jsonb,
  moved JSONB NOT NULL DEFAULT '{}'::jsonb,
  merged_by TEXT,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_merge_log_tenant ON contact_merge_log(tenant_id, merged_at DESC);

ALTER TABLE contact_merge_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON contact_merge_log;
CREATE POLICY "tenant_isolation" ON contact_merge_log
  USING (tenant_id = my_tenant_id());

-- Supprime, avant rattachement, les lignes des doublons qui violeraient un index
-- unique une fois rattachées à la fiche conservée (ou entre elles).
CREATE OR REPLACE FUNCTION contact_merge_dedupe(
  p_tbl TEXT, p_id_col TEXT, p_type_col TEXT, p_keys TEXT[],
  p_tenant UUID, p_primary TEXT, p_dups TEXT[]
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  k TEXT;
  eq TEXT := 'true';
  typ_a TEXT := '';
  typ_b TEXT := '';
BEGIN
  IF to_regclass(p_tbl) IS NULL THEN RETURN; END IF;
  FOREACH k IN ARRAY p_keys LOOP
    eq := eq || format(' AND a.%I = b.%I', k, k);
  END LOOP;
  IF p_type_col IS NOT NULL THEN
    typ_a := format(' AND a.%I = %L', p_type_col, 'contact');
    typ_b := format(' AND b.%I = %L', p_type_col, 'contact');
  END IF;
  -- Déjà couvert par la fiche conservée.
  EXECUTE format(
    'DELETE FROM %I a USING %I b WHERE a.tenant_id = $1 AND b.tenant_id = $1 AND a.%I = ANY($2) AND b.%I = $3%s%s AND %s',
    p_tbl, p_tbl, p_id_col, p_id_col, typ_a, typ_b, eq
  ) USING p_tenant, p_dups, p_primary;
  -- Deux doublons identiques entre eux : on n'en garde qu'un.
  EXECUTE format(
    'DELETE FROM %I a USING %I b WHERE a.tenant_id = $1 AND b.tenant_id = $1 AND a.%I = ANY($2) AND b.%I = ANY($2)%s%s AND a.ctid > b.ctid AND %s',
    p_tbl, p_tbl, p_id_col, p_id_col, typ_a, typ_b, eq
  ) USING p_tenant, p_dups;
END;
$$;

CREATE OR REPLACE FUNCTION merge_contacts(
  p_tenant UUID, p_primary TEXT, p_dups TEXT[],
  p_patch JSONB DEFAULT '{}'::jsonb, p_actor TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_dups TEXT[];
  v_all TEXT[];
  v_found INT;
  n INT;
  v_moved JSONB := '{}'::jsonb;
  v_merged JSONB;
  v_pname TEXT;
  v_ragic TEXT;
  v_odoo INT;
  v_google TEXT;
  v_ca NUMERIC;
  v_sets TEXT;
  v_old TEXT;
  v_new TEXT;
  v_text_cols TEXT[] := ARRAY[
    'prefix','first_name','middle_name','last_name','suffix','nickname','company_name','job_title','department',
    'email_work','email_home','email_other','email',
    'phone_mobile','phone_work','phone_home','phone_main','phone_fax_work','phone_fax_home','phone_pager','phone_other','phone',
    'address_work_street','address_work_city','address_work_state','address_work_zip','address_work_country',
    'address_home_street','address_home_city','address_home_state','address_home_zip','address_home_country',
    'address','zip','city','state','country',
    'candidatures','affaires','logo','electronic_signature','contact_references','tags',
    'category','notes','birthday','website','siret','vat_number','market_number'
  ];
  v_json_cols TEXT[] := ARRAY['corps_etat','specialite'];
  -- (table, colonne) qui portent un identifiant de contact.
  v_refs TEXT[][] := ARRAY[
    ['consultation_depot_invites','contact_id'],
    ['contact_qualifications','contact_id'],
    ['contrats_moe','client_id'],
    ['documents','contact_id'],
    ['doe_requests','contact_id'],
    ['invoices','billing_contact_id'],
    ['invoices','client_id'],
    ['marches_entreprises','contact_id'],
    ['marches_entreprises','act_entreprise_id'],
    ['meeting_attendees','contact_id'],
    ['observations','contact_id'],
    ['phone_calls','contact_id'],
    ['project_cotraitants','contact_id'],
    ['project_lots','contact_id'],
    ['project_stakeholders','contact_id'],
    ['projects','client_id'],
    ['proposal_specialties','contact_id'],
    ['proposals','client_id'],
    ['proposals','contact_id'],
    ['tender_groupement_membres','contact_id'],
    ['tender_partner_solicitations','contact_id'],
    ['tender_specialties','contact_id']
  ];
  -- (table, colonne jsonb) où l'identifiant d'un contact est une valeur.
  v_json_refs TEXT[][] := ARRAY[
    ['act_data','consultation'],
    ['act_data','companies'],
    ['act_data','lots'],
    ['accord_cadre_consultations','offres'],
    ['bpu_data','offres'],
    ['dpgfs','offres'],
    ['contrats_moe','cotraitants'],
    ['contrats_moe','sous_traitants'],
    ['custom_references','cotraitants'],
    ['notes_honoraires','cotraitants_facturation'],
    ['notes_honoraires','sous_traitants_facturation'],
    ['site_reports','attendance'],
    ['site_reports','lot_tracking']
  ];
  i INT;
  v_tbl TEXT;
  v_col TEXT;
  d TEXT;
BEGIN
  SELECT array_agg(DISTINCT x) INTO v_dups FROM unnest(p_dups) x WHERE x IS NOT NULL AND x <> p_primary;
  IF p_primary IS NULL OR v_dups IS NULL OR array_length(v_dups, 1) < 1 THEN
    RAISE EXCEPTION 'merge_contacts: au moins un doublon distinct de la fiche conservée est requis' USING ERRCODE = '22023';
  END IF;
  IF array_length(v_dups, 1) > 10 THEN
    RAISE EXCEPTION 'merge_contacts: 10 doublons au plus par fusion' USING ERRCODE = '22023';
  END IF;
  v_all := v_dups || p_primary;

  -- Verrou de toutes les fiches, dans un ordre fixe (pas d'interblocage entre deux fusions).
  PERFORM 1 FROM contacts WHERE tenant_id = p_tenant AND id = ANY(v_all) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_found FROM contacts WHERE tenant_id = p_tenant AND id = ANY(v_all);
  IF v_found <> array_length(v_all, 1) THEN
    RAISE EXCEPTION 'merge_contacts: contact introuvable pour ce cabinet' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(nullif(company_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')))
    INTO v_pname FROM contacts WHERE tenant_id = p_tenant AND id = p_primary;
  SELECT jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(nullif(company_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')))))
    INTO v_merged FROM contacts WHERE tenant_id = p_tenant AND id = ANY(v_dups);
  SELECT sum(ca_amount) INTO v_ca FROM contacts WHERE tenant_id = p_tenant AND id = ANY(v_all);
  SELECT (array_agg(ragic_id) FILTER (WHERE ragic_id IS NOT NULL))[1],
         (array_agg(odoo_id) FILTER (WHERE odoo_id IS NOT NULL))[1],
         (array_agg(google_resource_name) FILTER (WHERE google_resource_name IS NOT NULL))[1]
    INTO v_ragic, v_odoo, v_google
    FROM contacts WHERE tenant_id = p_tenant AND id = ANY(v_dups);

  -- 1. Lignes qui entreraient en conflit d'unicité une fois rattachées.
  PERFORM contact_merge_dedupe('meeting_attendees', 'contact_id', NULL, ARRAY['meeting_id'], p_tenant, p_primary, v_dups);
  PERFORM contact_merge_dedupe('contact_qualifications', 'contact_id', NULL, ARRAY['organisme', 'reference'], p_tenant, p_primary, v_dups);
  PERFORM contact_merge_dedupe('email_links', 'local_id', 'local_type', ARRAY['connection_id', 'external_message_id'], p_tenant, p_primary, v_dups);
  PERFORM contact_merge_dedupe('email_folder_links', 'local_id', 'local_type', ARRAY['connection_id', 'folder_id'], p_tenant, p_primary, v_dups);

  -- 2. Colonnes de clé étrangère.
  FOR i IN 1 .. array_length(v_refs, 1) LOOP
    v_tbl := v_refs[i][1];
    v_col := v_refs[i][2];
    IF to_regclass(v_tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = v_tbl AND column_name = v_col) THEN CONTINUE; END IF;
    EXECUTE format('UPDATE %I SET %I = $1 WHERE tenant_id = $2 AND %I = ANY($3)', v_tbl, v_col, v_col)
      USING p_primary, p_tenant, v_dups;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_moved := v_moved || jsonb_build_object(v_tbl || '.' || v_col, n); END IF;
  END LOOP;

  -- 3. Liens polymorphes : e-mails et documents rattachés à la fiche.
  IF to_regclass('email_links') IS NOT NULL THEN
    UPDATE email_links SET local_id = p_primary WHERE tenant_id = p_tenant AND local_type = 'contact' AND local_id = ANY(v_dups);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_moved := v_moved || jsonb_build_object('email_links', n); END IF;
  END IF;
  IF to_regclass('email_folder_links') IS NOT NULL THEN
    UPDATE email_folder_links SET local_id = p_primary WHERE tenant_id = p_tenant AND local_type = 'contact' AND local_id = ANY(v_dups);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_moved := v_moved || jsonb_build_object('email_folder_links', n); END IF;
  END IF;
  IF to_regclass('documents') IS NOT NULL THEN
    UPDATE documents SET resource_id = p_primary WHERE tenant_id = p_tenant AND resource_type = 'contacts' AND resource_id = ANY(v_dups);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN v_moved := v_moved || jsonb_build_object('documents.resource_id', n); END IF;
  END IF;

  -- 4. Références stockées dans du jsonb : remplacement de la valeur exacte "<id>".
  FOR i IN 1 .. array_length(v_json_refs, 1) LOOP
    v_tbl := v_json_refs[i][1];
    v_col := v_json_refs[i][2];
    IF to_regclass(v_tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = v_tbl AND column_name = v_col) THEN CONTINUE; END IF;
    v_new := to_jsonb(p_primary)::text;
    FOREACH d IN ARRAY v_dups LOOP
      v_old := to_jsonb(d)::text;
      EXECUTE format('UPDATE %I SET %I = replace(%I::text, $1, $2)::jsonb WHERE tenant_id = $3 AND position($1 in %I::text) > 0', v_tbl, v_col, v_col, v_col)
        USING v_old, v_new, p_tenant;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN v_moved := v_moved || jsonb_build_object(v_tbl || '.' || v_col, coalesce((v_moved ->> (v_tbl || '.' || v_col))::int, 0) + n); END IF;
    END LOOP;
  END LOOP;

  -- 5. Suppression des doublons (avant la mise à jour de la fiche : un identifiant de
  --    synchro externe peut être unique).
  DELETE FROM contacts WHERE tenant_id = p_tenant AND id = ANY(v_dups);

  -- 6. Valeurs choisies à l'écran (liste blanche), identifiants externes repris, CA cumulé.
  SELECT string_agg(
           CASE WHEN e.key = ANY(v_json_cols)
                THEN format('%I = %L::jsonb', e.key, e.value::text)
                ELSE format('%I = %L', e.key, e.value #>> '{}') END, ', ')
    INTO v_sets
    FROM jsonb_each(coalesce(p_patch, '{}'::jsonb)) e
    WHERE e.key = ANY(v_text_cols) OR e.key = ANY(v_json_cols);
  IF v_sets IS NOT NULL THEN
    EXECUTE format('UPDATE contacts SET %s WHERE tenant_id = $1 AND id = $2', v_sets) USING p_tenant, p_primary;
  END IF;
  UPDATE contacts SET
    ragic_id = coalesce(ragic_id, v_ragic),
    odoo_id = coalesce(odoo_id, v_odoo),
    google_resource_name = coalesce(google_resource_name, v_google),
    ca_amount = coalesce(v_ca, ca_amount)
  WHERE tenant_id = p_tenant AND id = p_primary;

  INSERT INTO contact_merge_log (tenant_id, primary_id, primary_name, merged, moved, merged_by)
  VALUES (p_tenant, p_primary, v_pname, coalesce(v_merged, '[]'::jsonb), v_moved, p_actor);

  RETURN jsonb_build_object('primary_id', p_primary, 'merged_ids', to_jsonb(v_dups), 'moved', v_moved);
END;
$$;

REVOKE ALL ON FUNCTION contact_merge_dedupe(TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_contacts(UUID, TEXT, TEXT[], JSONB, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION contact_merge_dedupe(TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TEXT[]) FROM anon;
    REVOKE ALL ON FUNCTION merge_contacts(UUID, TEXT, TEXT[], JSONB, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION contact_merge_dedupe(TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TEXT[]) FROM authenticated;
    REVOKE ALL ON FUNCTION merge_contacts(UUID, TEXT, TEXT[], JSONB, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION contact_merge_dedupe(TEXT, TEXT, TEXT, TEXT[], UUID, TEXT, TEXT[]) TO service_role;
    GRANT EXECUTE ON FUNCTION merge_contacts(UUID, TEXT, TEXT[], JSONB, TEXT) TO service_role;
  END IF;
END
$$;
