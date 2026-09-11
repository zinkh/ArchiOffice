-- Ferme deux courses de facturation IA identifiées en audit :
--
-- 1. « reserve → exécute → règle » au lieu de « exécute → déduit ». Jusqu'ici
--    le solde était lu une fois avant l'appel au modèle (potentiellement
--    long, plusieurs secondes) puis déduit après coup — cinq appels
--    concurrents contre 1 € de solde restant passaient tous le contrôle
--    initial, coûtaient chacun un vrai appel au fournisseur, et la
--    déduction plafonnée à zéro masquait le dépassement plutôt que de
--    l'empêcher. reserve_ai_credit() fait le contrôle ET l'écriture dans
--    la même instruction : sous verrou de ligne Postgres, deux appels
--    concurrents contre un solde insuffisant pour les deux ne peuvent plus
--    tous les deux réussir. settle_ai_credit() régularise ensuite contre
--    le coût réel (remboursement du surplus réservé, ou complément si le
--    réel dépasse la réservation), toujours plafonné à zéro.
--
-- 2. La recharge mensuelle gratuite (« lire ai_credit_last_refresh, écrire
--    si absent/périmé ») avait la même faille : deux premiers appels du
--    mois exécutés en même temps lisaient tous les deux l'ancienne date et
--    créditaient tous les deux le montant mensuel. refresh_monthly_ai_credits()
--    fait la vérification et l'écriture dans la même instruction.

CREATE OR REPLACE FUNCTION reserve_ai_credit(p_tenant_id UUID, p_amount_cents INTEGER)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE tenants
  SET ai_credit_balance_eur_cents = ai_credit_balance_eur_cents - p_amount_cents
  WHERE id = p_tenant_id AND ai_credit_balance_eur_cents >= p_amount_cents;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION settle_ai_credit(p_tenant_id UUID, p_delta_cents INTEGER)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants
  SET ai_credit_balance_eur_cents = GREATEST(0, ai_credit_balance_eur_cents + p_delta_cents)
  WHERE id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION refresh_monthly_ai_credits(p_tenant_id UUID, p_amount_cents INTEGER)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE tenants
  SET ai_credit_balance_eur_cents = ai_credit_balance_eur_cents + p_amount_cents,
      ai_credit_last_refresh = NOW()
  WHERE id = p_tenant_id
    AND (ai_credit_last_refresh IS NULL OR ai_credit_last_refresh < date_trunc('month', NOW()));
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;
