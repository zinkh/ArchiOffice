-- Migration : numéro d'affaire des projets déjà convertis depuis une proposition
--
-- Avant server/projectCode.ts, la conversion d'une proposition acceptée ne donnait pas de
-- numéro d'affaire (`project_code` vide : « #--- » sur la carte). Ce rattrapage en attribue
-- un à chaque affaire issue d'une proposition (`source_proposal_id`) qui n'en a pas, dans
-- l'ordre de la conversion (`start_date`, posée au jour de la conversion), à la suite du
-- plus grand numéro déjà donné cette année-là, au format réglé par le cabinet
-- (settings.num_prefix_affaire, num_affaire_sep_prefix, num_affaire_sep_seq,
-- num_affaire_digits : mêmes règles par défaut que server/projectCode.ts).
--
-- Rejouable : une affaire qui a déjà un numéro n'est jamais touchée. Ne crée ni ne supprime
-- rien, ne remplit que des `project_code` vides.

DO $$
DECLARE
  r record;
  v_prefix text;
  v_sep_prefix boolean;
  v_sep_seq boolean;
  v_digits integer;
  v_year text;
  v_head text;
  v_next integer;
  s_prefix text; s_sep_prefix boolean; s_sep_seq boolean; s_digits integer;
BEGIN
  FOR r IN
    SELECT id, tenant_id, start_date::text AS start_date
      FROM projects
     WHERE source_proposal_id IS NOT NULL
       AND (project_code IS NULL OR btrim(project_code) = '')
     ORDER BY tenant_id, start_date, id
  LOOP
    s_prefix := NULL; s_sep_prefix := NULL; s_sep_seq := NULL; s_digits := NULL;
    SELECT num_prefix_affaire, num_affaire_sep_prefix, num_affaire_sep_seq, num_affaire_digits
      INTO s_prefix, s_sep_prefix, s_sep_seq, s_digits
      FROM settings WHERE tenant_id = r.tenant_id LIMIT 1;

    v_prefix := btrim(coalesce(s_prefix, ''));
    v_sep_prefix := coalesce(s_sep_prefix, true);
    v_sep_seq := coalesce(s_sep_seq, v_prefix <> '');
    v_digits := CASE WHEN s_digits BETWEEN 1 AND 6 THEN s_digits ELSE 3 END;
    v_year := CASE WHEN r.start_date ~ '^\d{4}-' THEN substr(r.start_date, 3, 2) ELSE to_char(now(), 'YY') END;
    v_head := v_prefix || CASE WHEN v_prefix <> '' AND v_sep_prefix THEN '-' ELSE '' END
              || v_year || CASE WHEN v_sep_seq THEN '-' ELSE '' END;

    SELECT coalesce(max(substr(btrim(project_code), length(v_head) + 1)::integer), 0) + 1
      INTO v_next
      FROM projects
     WHERE tenant_id = r.tenant_id
       AND project_code IS NOT NULL
       AND left(btrim(project_code), length(v_head)) = v_head
       AND substr(btrim(project_code), length(v_head) + 1) ~ '^\d{1,9}$';

    UPDATE projects
       SET project_code = v_head || lpad(v_next::text, v_digits, '0')
     WHERE id = r.id;
  END LOOP;
END $$;
