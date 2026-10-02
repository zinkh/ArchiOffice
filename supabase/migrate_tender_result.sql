-- Résultat de la consultation d'un appel d'offres : enveloppe prévisionnelle
-- des honoraires (saisie manuellement ou recherchée par l'IA dans le DCE,
-- server/routes/tenderAi.ts, plan Enterprise), puis, une fois la
-- consultation achevée, l'entreprise (ou le cabinet) retenu et le montant
-- des honoraires réellement obtenus — le pourcentage se déduit des deux à
-- l'affichage (src/pages/TenderDetail.tsx), jamais stocké.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS enveloppe_previsionnelle NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS entreprise_retenue TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS honoraires_retenus_montant NUMERIC;

-- Type de procédure (Concours/MAPA), détecté heuristiquement dans le texte
-- de l'annonce RSS avant conversion en appel d'offres — voir
-- server/tenderFieldExtractor.ts et server/routes/tenderRss.ts.
ALTER TABLE tender_rss_matches ADD COLUMN IF NOT EXISTS type_marche TEXT;
