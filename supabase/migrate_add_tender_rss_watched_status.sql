-- Ajoute le statut 'watched' aux annonces de veille RSS (tender_rss_matches) :
-- une annonce "surveillée" par l'utilisateur bascule dans l'onglet "Annonces
-- sélectionnées" (src/components/TenderRssSelected.tsx), et ce n'est qu'à ce
-- moment-là que la conversion en appel d'offres est proposée.

ALTER TABLE tender_rss_matches DROP CONSTRAINT IF EXISTS tender_rss_matches_status_check;
ALTER TABLE tender_rss_matches ADD CONSTRAINT tender_rss_matches_status_check
  CHECK (status IN ('new', 'read', 'dismissed', 'watched', 'converted'));
