-- ── Accords-cadres à plusieurs titulaires et remise en concurrence ──────────
--
-- Un accord-cadre multi-attributaires reste un ensemble de lignes
-- `marches_entreprises` de type 'accord_cadre', UNE PAR TITULAIRE (chacune avec
-- son bordereau figé, sa signature, ses subséquents). Une ligne « de tête » porte
-- les conditions communes (maximum, minimum, fin) ; les autres titulaires
-- (`accord_cadre_groupe_id` = la tête) n'ont aucune condition propre : le plafond
-- est PARTAGÉ par tout le groupe.
--
-- `enregistrer_marche_subsequent` devient sensible au groupe : elle verrouille la
-- tête (toujours en premier, puis le titulaire : deux émissions simultanées chez
-- deux titulaires ne peuvent pas s'étreindre), cumule les subséquents de TOUT le
-- groupe contre le maximum de la tête et numérote à l'échelle du groupe.
--
-- `accord_cadre_consultations` porte la remise en concurrence entre titulaires
-- d'un subséquent : objet, lignes à commander, offres par titulaire, attribution.

ALTER TABLE marches_entreprises
  ADD COLUMN IF NOT EXISTS accord_cadre_groupe_id UUID REFERENCES marches_entreprises(id) ON DELETE RESTRICT;

ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_groupe_coherent_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_groupe_coherent_check
  CHECK (accord_cadre_groupe_id IS NULL OR (type_marche = 'accord_cadre' AND accord_cadre_groupe_id <> id));

CREATE INDEX IF NOT EXISTS marches_entreprises_groupe
  ON marches_entreprises(tenant_id, accord_cadre_groupe_id);

CREATE OR REPLACE FUNCTION enregistrer_marche_subsequent(
  p_tenant_id UUID, p_parent_id UUID, p_row JSONB, p_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_parent  marches_entreprises%ROWTYPE;
  v_head    marches_entreprises%ROWTYPE;
  v_current marches_entreprises%ROWTYPE;
  v_head_id UUID;
  v_cumul   NUMERIC;
  v_montant NUMERIC;
  v_date    DATE;
  v_num     INTEGER;
  v_result  marches_entreprises%ROWTYPE;
BEGIN
  SELECT * INTO v_parent FROM marches_entreprises
    WHERE id = p_parent_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCORD_CADRE_INTROUVABLE'; END IF;

  -- Tête d'abord, titulaire ensuite : toujours le même ordre de verrouillage.
  v_head_id := COALESCE(v_parent.accord_cadre_groupe_id, v_parent.id);
  SELECT * INTO v_head FROM marches_entreprises
    WHERE id = v_head_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCORD_CADRE_INTROUVABLE'; END IF;
  IF v_head_id <> p_parent_id THEN
    SELECT * INTO v_parent FROM marches_entreprises
      WHERE id = p_parent_id AND tenant_id = p_tenant_id FOR UPDATE;
  ELSE
    v_parent := v_head;
  END IF;

  IF v_parent.type_marche <> 'accord_cadre' OR v_head.type_marche <> 'accord_cadre' THEN
    RAISE EXCEPTION 'ACCORD_CADRE_INVALIDE';
  END IF;
  IF v_parent.statut_signature <> 'signe' THEN RAISE EXCEPTION 'ACCORD_CADRE_NON_SIGNE'; END IF;

  v_montant := COALESCE((p_row->>'montant_ht')::NUMERIC, 0);
  IF v_montant < 0 THEN RAISE EXCEPTION 'MONTANT_INVALIDE'; END IF;
  v_date := COALESCE(NULLIF(p_row->>'date_notification', '')::DATE, CURRENT_DATE);

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_current FROM marches_entreprises
      WHERE id = p_id AND tenant_id = p_tenant_id AND parent_marche_id = p_parent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUBSEQUENT_INTROUVABLE'; END IF;
    IF v_current.statut_signature = 'signe' THEN RAISE EXCEPTION 'SUBSEQUENT_SIGNE'; END IF;
  END IF;

  -- Seule la notification est bornée par la fin de l'accord-cadre (celle de la tête).
  IF v_head.date_fin_accord_cadre IS NOT NULL AND v_date > v_head.date_fin_accord_cadre THEN
    RAISE EXCEPTION 'ACCORD_CADRE_ECHU';
  END IF;

  SELECT COALESCE(sum(s.montant_ht), 0) INTO v_cumul FROM marches_entreprises s
    WHERE s.tenant_id = p_tenant_id AND s.type_marche = 'subsequent'
      AND s.parent_marche_id IN (
        SELECT g.id FROM marches_entreprises g
        WHERE g.tenant_id = p_tenant_id AND (g.id = v_head_id OR g.accord_cadre_groupe_id = v_head_id))
      AND COALESCE(s.statut, 'en_cours') <> 'resilie'
      AND (p_id IS NULL OR s.id <> p_id);
  IF v_head.montant_maxi_ht IS NOT NULL AND v_cumul + v_montant > v_head.montant_maxi_ht THEN
    RAISE EXCEPTION 'PLAFOND_DEPASSE:%', GREATEST(v_head.montant_maxi_ht - v_cumul, 0);
  END IF;

  IF p_id IS NULL THEN
    SELECT COALESCE(max(s.numero_subsequent), 0) + 1 INTO v_num FROM marches_entreprises s
      WHERE s.tenant_id = p_tenant_id AND s.type_marche = 'subsequent'
        AND s.parent_marche_id IN (
          SELECT g.id FROM marches_entreprises g
          WHERE g.tenant_id = p_tenant_id AND (g.id = v_head_id OR g.accord_cadre_groupe_id = v_head_id));
    INSERT INTO marches_entreprises (
      tenant_id, project_id, type_marche, parent_marche_id, numero_subsequent,
      entreprise_nom, contact_id, act_entreprise_id, lot_numero, lot_titre,
      montant_ht, tva_rate, objet, lignes_commande, date_notification, duree_mois,
      notes, statut_signature, offre_snapshot
    ) VALUES (
      p_tenant_id, v_parent.project_id, 'subsequent', p_parent_id, v_num,
      v_parent.entreprise_nom, v_parent.contact_id, v_parent.act_entreprise_id,
      v_parent.lot_numero, v_parent.lot_titre,
      v_montant, COALESCE((p_row->>'tva_rate')::NUMERIC, v_parent.tva_rate),
      NULLIF(p_row->>'objet', ''), p_row->'lignes_commande',
      NULLIF(p_row->>'date_notification', '')::DATE,
      NULLIF(p_row->>'duree_mois', '')::INTEGER, NULLIF(p_row->>'notes', ''),
      'a_signer', NULL
    ) RETURNING * INTO v_result;
  ELSE
    UPDATE marches_entreprises SET
      montant_ht = v_montant,
      tva_rate = COALESCE((p_row->>'tva_rate')::NUMERIC, tva_rate),
      objet = NULLIF(p_row->>'objet', ''),
      lignes_commande = p_row->'lignes_commande',
      date_notification = NULLIF(p_row->>'date_notification', '')::DATE,
      duree_mois = NULLIF(p_row->>'duree_mois', '')::INTEGER,
      notes = NULLIF(p_row->>'notes', ''),
      updated_at = NOW()
    WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_result;
  END IF;

  RETURN to_jsonb(v_result);
END;
$$;

CREATE TABLE IF NOT EXISTS accord_cadre_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  -- La ligne de tête de l'accord-cadre (celle qui porte le plafond).
  accord_cadre_id UUID NOT NULL REFERENCES marches_entreprises(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  objet TEXT NOT NULL DEFAULT '',
  date_limite DATE,
  -- [{ articleId, refBpu, designation, unite, quantite }]
  lignes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ marche_id, prix: { articleId: P.U. HT }, delai_jours, remarques, recue_le, declinee }]
  offres JSONB NOT NULL DEFAULT '[]'::jsonb,
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'attribuee', 'abandonnee')),
  retenue_marche_id UUID REFERENCES marches_entreprises(id) ON DELETE SET NULL,
  subsequent_id UUID REFERENCES marches_entreprises(id) ON DELETE SET NULL,
  motif_choix TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS accord_cadre_consultations_numero
  ON accord_cadre_consultations(accord_cadre_id, numero);
CREATE INDEX IF NOT EXISTS accord_cadre_consultations_tenant
  ON accord_cadre_consultations(tenant_id, accord_cadre_id);

ALTER TABLE accord_cadre_consultations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON accord_cadre_consultations;
CREATE POLICY "tenant_isolation" ON accord_cadre_consultations
  USING (tenant_id = my_tenant_id());
