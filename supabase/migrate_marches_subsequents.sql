-- ── Accords-cadres et marchés subséquents ───────────────────────────────────
--
-- Un accord-cadre à bons de commande ou à marchés subséquents est une ligne de
-- marches_entreprises (type_marche = 'accord_cadre'). Chaque marché subséquent
-- est une ligne enfant (type_marche = 'subsequent', parent_marche_id) : les OS,
-- situations et certificats de paiement, qui s'accrochent tous à marche_id,
-- fonctionnent donc sans changement sur un subséquent.
--
-- Toutes les colonnes sont facultatives : un marché existant reste un marché
-- ordinaire (type_marche = 'marche').
--
-- Le plafond ne se vérifie pas dans le code applicatif : deux subséquents créés
-- en même temps liraient le même cumul et dépasseraient tous deux le maxi.
-- `enregistrer_marche_subsequent` prend un verrou de ligne sur l'accord-cadre,
-- vérifie signature, échéance et plafond, numérote et écrit dans la même
-- transaction (même principe que reserve_ai_credit).

ALTER TABLE marches_entreprises
  ADD COLUMN IF NOT EXISTS type_marche TEXT NOT NULL DEFAULT 'marche',
  ADD COLUMN IF NOT EXISTS parent_marche_id UUID REFERENCES marches_entreprises(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS numero_subsequent INTEGER,
  ADD COLUMN IF NOT EXISTS mode_execution TEXT,
  ADD COLUMN IF NOT EXISTS montant_mini_ht NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS montant_maxi_ht NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS date_fin_accord_cadre DATE,
  ADD COLUMN IF NOT EXISTS objet TEXT,
  ADD COLUMN IF NOT EXISTS lignes_commande JSONB,
  ADD COLUMN IF NOT EXISTS date_notification DATE;

ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_type_marche_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_type_marche_check
  CHECK (type_marche IN ('marche', 'accord_cadre', 'subsequent'));
ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_mode_execution_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_mode_execution_check
  CHECK (mode_execution IS NULL OR mode_execution IN ('bons_de_commande', 'marches_subsequents', 'mixte'));
-- Un subséquent a un parent, un marché ou un accord-cadre n'en a pas.
ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_parent_coherent_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_parent_coherent_check
  CHECK ((type_marche = 'subsequent') = (parent_marche_id IS NOT NULL));
-- Le plafond ne peut pas être inférieur au minimum.
ALTER TABLE marches_entreprises DROP CONSTRAINT IF EXISTS marches_mini_maxi_check;
ALTER TABLE marches_entreprises ADD CONSTRAINT marches_mini_maxi_check
  CHECK (montant_mini_ht IS NULL OR montant_maxi_ht IS NULL OR montant_mini_ht <= montant_maxi_ht);

CREATE UNIQUE INDEX IF NOT EXISTS marches_entreprises_numero_subsequent
  ON marches_entreprises(parent_marche_id, numero_subsequent);
CREATE INDEX IF NOT EXISTS marches_entreprises_parent
  ON marches_entreprises(tenant_id, parent_marche_id);

-- Crée (p_id NULL) ou modifie (p_id renseigné) un marché subséquent.
-- Erreurs métier : le message commence par un code stable que la route traduit.
--   ACCORD_CADRE_INTROUVABLE, ACCORD_CADRE_INVALIDE, ACCORD_CADRE_NON_SIGNE,
--   ACCORD_CADRE_ECHU, PLAFOND_DEPASSE:<reste>, SUBSEQUENT_INTROUVABLE,
--   SUBSEQUENT_SIGNE, MONTANT_INVALIDE
CREATE OR REPLACE FUNCTION enregistrer_marche_subsequent(
  p_tenant_id UUID, p_parent_id UUID, p_row JSONB, p_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_parent  marches_entreprises%ROWTYPE;
  v_current marches_entreprises%ROWTYPE;
  v_cumul   NUMERIC;
  v_montant NUMERIC;
  v_date    DATE;
  v_num     INTEGER;
  v_result  marches_entreprises%ROWTYPE;
BEGIN
  SELECT * INTO v_parent FROM marches_entreprises
    WHERE id = p_parent_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCORD_CADRE_INTROUVABLE'; END IF;
  IF v_parent.type_marche <> 'accord_cadre' THEN RAISE EXCEPTION 'ACCORD_CADRE_INVALIDE'; END IF;
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

  -- Seule la notification est bornée par la fin de l'accord-cadre : un subséquent
  -- notifié à temps peut s'exécuter au-delà.
  IF v_parent.date_fin_accord_cadre IS NOT NULL AND v_date > v_parent.date_fin_accord_cadre THEN
    RAISE EXCEPTION 'ACCORD_CADRE_ECHU';
  END IF;

  SELECT COALESCE(sum(montant_ht), 0) INTO v_cumul FROM marches_entreprises
    WHERE tenant_id = p_tenant_id AND parent_marche_id = p_parent_id
      AND COALESCE(statut, 'en_cours') <> 'resilie'
      AND (p_id IS NULL OR id <> p_id);
  IF v_parent.montant_maxi_ht IS NOT NULL AND v_cumul + v_montant > v_parent.montant_maxi_ht THEN
    RAISE EXCEPTION 'PLAFOND_DEPASSE:%', GREATEST(v_parent.montant_maxi_ht - v_cumul, 0);
  END IF;

  IF p_id IS NULL THEN
    SELECT COALESCE(max(numero_subsequent), 0) + 1 INTO v_num FROM marches_entreprises
      WHERE parent_marche_id = p_parent_id;
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

REVOKE ALL ON FUNCTION enregistrer_marche_subsequent(UUID, UUID, JSONB, UUID) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION enregistrer_marche_subsequent(UUID, UUID, JSONB, UUID) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION enregistrer_marche_subsequent(UUID, UUID, JSONB, UUID) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION enregistrer_marche_subsequent(UUID, UUID, JSONB, UUID) TO service_role;
  END IF;
END $$;
