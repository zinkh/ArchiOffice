-- Onglet Honoraires d'un appel d'offres MAPA (src/pages/TenderDetail.tsx) :
-- calcule les honoraires exactement comme dans une proposition (Assistant
-- complexité MIQCP + grille de répartition entre cotraitants,
-- src/components/HonorairesSection.tsx), donc les mêmes colonnes que
-- proposals pour ce qui manquait encore à tenders. tenders.value porte déjà
-- le montant des honoraires ("Évaluation (Honoraires estimés)"), et
-- surface/construction_cost/complexity_rate/base_fee_percent/
-- miqcp_assessment existaient déjà.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS fee_distribution TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 20;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS decimal_precision INTEGER DEFAULT 2;
