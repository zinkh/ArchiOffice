-- Migration: structured BOAMP-style fields for tender RSS matches + tenders
-- (ville d'exécution, pouvoir adjudicateur, montant des travaux, date limite
-- de réponse), extracted heuristically from the RSS description by
-- server/tenderFieldExtractor.ts.

-- Extracted at ingest time (tenderRssPoller.ts), shown in the match feed
-- before conversion.
ALTER TABLE tender_rss_matches ADD COLUMN IF NOT EXISTS ville_execution TEXT;
ALTER TABLE tender_rss_matches ADD COLUMN IF NOT EXISTS pouvoir_adjudicateur TEXT;
ALTER TABLE tender_rss_matches ADD COLUMN IF NOT EXISTS montant_travaux NUMERIC;
ALTER TABLE tender_rss_matches ADD COLUMN IF NOT EXISTS date_limite_reponse TEXT;

-- tenders already has client (pouvoir adjudicateur), construction_cost
-- (montant des travaux) and submission_deadline (date limite de réponse) —
-- only ville d'exécution is a genuinely new concept there.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS ville_execution TEXT;
