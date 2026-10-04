-- Situations de travaux des entreprises et certificats de paiement de l'architecte.
-- Une situation porte le cumul HT présenté par l'entreprise depuis le début du
-- marché ; l'architecte retient un cumul admis (vide : le présenté est admis) et
-- établit le certificat de paiement de la période. Calcul : src/lib/certificatPaiement.ts.
ALTER TABLE situations
  ADD COLUMN IF NOT EXISTS reference_entreprise TEXT,
  ADD COLUMN IF NOT EXISTS montant_presente_ht NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS montant_admis_ht NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS date_certificat DATE;

-- La numérotation se fait par marché : la recherche de la situation précédente
-- se fait sur (marché, numéro).
CREATE INDEX IF NOT EXISTS idx_situations_marche_numero
  ON situations(tenant_id, marche_id, numero_situation);
