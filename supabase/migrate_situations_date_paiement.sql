-- Date de règlement d'une situation de travaux (état « Payée »), pour le tableau
-- récapitulatif par lot de l'onglet RDT. Additive : NULL = date non renseignée.
ALTER TABLE public.situations ADD COLUMN IF NOT EXISTS date_paiement DATE;
COMMENT ON COLUMN public.situations.date_paiement IS 'Date de règlement du certificat de paiement par le maître d''ouvrage (état Payée).';
