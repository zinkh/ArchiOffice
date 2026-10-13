-- ── Numérotation atomique des devis, notes d'honoraires et factures ─────────
--
-- Jusqu'ici le numéro suivant se calculait en comptant les lignes de la table
-- puis en ajoutant 1 (server/getNextDocNumber.ts) : deux créations simultanées
-- pour un même cabinet lisaient le même total et recevaient le même numéro.
-- Pour les factures, l'index unique (tenant_id, invoice_number) refuse le
-- doublon mais fait échouer la seconde création ; pour les devis et les notes
-- d'honoraires, rien ne l'empêchait (trois notes d'un même cabinet portent déjà
-- « NH-01 » en production).
--
-- `next_document_number(tenant, série)` fait l'incrément dans une seule
-- instruction UPDATE ... RETURNING : sous le verrou de ligne de Postgres, deux
-- appels concurrents ne peuvent plus recevoir la même valeur.
--
-- Une série par cabinet, SANS remise à zéro annuelle : le comptage d'origine ne
-- repartait pas de 1 au changement d'année (l'année n'est qu'un élément du
-- libellé « PRÉFIXE-AAAA-001 »), la séquence garde donc ce comportement.
--
-- Séries :
--   'invoice'          factures (invoices.invoice_number)
--   'proposal'         devis (proposals.reference)
--   'note_honoraires'  notes d'honoraires (notes_honoraires.numero)
--   'acompte:<projet>' référence métier des factures d'acompte d'une affaire
--
-- Amorçage : la première fois qu'une série est demandée, elle démarre au plus
-- grand de deux nombres, de sorte que le premier numéro émis ne puisse pas
-- entrer en collision avec l'existant :
--   - le nombre de lignes déjà présentes (ce que l'ancien calcul utilisait) ;
--   - le plus grand suffixe d'un numéro de la forme « …-AAAA-NNN » (une
--     référence saisie à la main, comme « 2626 » ou « NH-01 », est ignorée :
--     la prendre pour une séquence ferait sauter la numérotation).
--
-- Un numéro réservé par une création qui échoue ensuite n'est pas rendu : la
-- séquence peut avoir un trou, jamais un doublon.

CREATE TABLE IF NOT EXISTS document_sequences (
  tenant_id  UUID   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  series     TEXT   NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (tenant_id, series)
);

-- Table réservée au serveur (service role, qui contourne la RLS) : activée sans
-- aucune politique, un compte connecté ne peut ni la lire ni l'écrire.
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION document_sequence_seed(p_tenant_id UUID, p_series TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_count BIGINT := 0;
  v_max   BIGINT := 0;
BEGIN
  IF p_series = 'invoice' THEN
    SELECT count(*), COALESCE(max((regexp_match(invoice_number, '-\d{4}-(\d{1,9})\s*$'))[1]::BIGINT), 0)
      INTO v_count, v_max FROM invoices WHERE tenant_id = p_tenant_id;
  ELSIF p_series = 'proposal' THEN
    SELECT count(*), COALESCE(max((regexp_match(reference, '-\d{4}-(\d{1,9})\s*$'))[1]::BIGINT), 0)
      INTO v_count, v_max FROM proposals WHERE tenant_id = p_tenant_id;
  ELSIF p_series = 'note_honoraires' THEN
    SELECT count(*), COALESCE(max((regexp_match(numero, '-\d{4}-(\d{1,9})\s*$'))[1]::BIGINT), 0)
      INTO v_count, v_max FROM notes_honoraires WHERE tenant_id = p_tenant_id;
  ELSIF p_series LIKE 'acompte:%' THEN
    SELECT count(*) INTO v_count FROM invoices
      WHERE tenant_id = p_tenant_id
        AND project_id = substring(p_series FROM 9)::UUID
        AND invoice_type = 'acompte';
  ELSE
    RAISE EXCEPTION 'Série de numérotation inconnue : %', p_series;
  END IF;
  RETURN GREATEST(v_count, v_max);
END;
$$;

CREATE OR REPLACE FUNCTION next_document_number(p_tenant_id UUID, p_series TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_next BIGINT;
BEGIN
  -- Amorçage à la première demande seulement : le calcul de départ compte des
  -- lignes, inutile de le refaire à chaque numéro. Deux premiers appels
  -- simultanés calculent la même valeur de départ, l'un insère, l'autre est
  -- ignoré par ON CONFLICT.
  IF NOT EXISTS (SELECT 1 FROM document_sequences WHERE tenant_id = p_tenant_id AND series = p_series) THEN
    INSERT INTO document_sequences (tenant_id, series, last_value)
    VALUES (p_tenant_id, p_series, document_sequence_seed(p_tenant_id, p_series))
    ON CONFLICT (tenant_id, series) DO NOTHING;
  END IF;

  UPDATE document_sequences SET last_value = last_value + 1
  WHERE tenant_id = p_tenant_id AND series = p_series
  RETURNING last_value INTO v_next;

  RETURN v_next;
END;
$$;

-- Réservées au serveur : sans cela, n'importe quel compte connecté pourrait
-- appeler la fonction par l'API REST et faire avancer la séquence d'un autre
-- cabinet. Les rôles Supabase n'existent pas sur le Postgres local d'Electron,
-- d'où le test d'existence.
REVOKE ALL ON FUNCTION document_sequence_seed(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION next_document_number(UUID, TEXT) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION document_sequence_seed(UUID, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION next_document_number(UUID, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION document_sequence_seed(UUID, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION next_document_number(UUID, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION document_sequence_seed(UUID, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION next_document_number(UUID, TEXT) TO service_role;
  END IF;
END $$;
