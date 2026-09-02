-- Connecteur BOAMP (API ouverte OpenDataSoft du Bulletin officiel des
-- annonces des marchés publics) comme second type de source de veille, à
-- côté des flux RSS. Activable par cabinet depuis Paramètres > Marketplace
-- (settings.tender_boamp_enabled) ; les critères de recherche propres au
-- connecteur (départements, types de marché, avis initiaux seulement,
-- fenêtre de publication) sont stockés dans tender_rss_sources.boamp_config.
-- Voir server/tenderBoampConnector.ts.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tender_boamp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tender_rss_sources
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'rss',
  ADD COLUMN IF NOT EXISTS boamp_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tender_rss_sources DROP CONSTRAINT IF EXISTS tender_rss_sources_source_type_check;
ALTER TABLE tender_rss_sources ADD CONSTRAINT tender_rss_sources_source_type_check
  CHECK (source_type IN ('rss', 'boamp'));
