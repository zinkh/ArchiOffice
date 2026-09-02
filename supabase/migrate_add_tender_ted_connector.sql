-- Connecteur TED (API de recherche du Journal officiel de l'UE) comme
-- troisième type de source de veille, activable par cabinet dans Paramètres >
-- Marketplace (settings.tender_ted_enabled), avec ses critères dans
-- tender_rss_sources.ted_config. Voir server/tenderTedConnector.ts.
--
-- Déduplication inter-sources : un même avis relayé par le BOAMP, TED et un
-- flux RSS n'est inséré qu'une fois. La clé (md5 du titre normalisé, plus md5
-- de l'acheteur normalisé) est calculée par server/tenderDedup.ts à
-- l'ingestion ; le même calcul est rejoué ici pour les lignes existantes.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tender_ted_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tender_rss_sources
  ADD COLUMN IF NOT EXISTS ted_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tender_rss_sources DROP CONSTRAINT IF EXISTS tender_rss_sources_source_type_check;
ALTER TABLE tender_rss_sources ADD CONSTRAINT tender_rss_sources_source_type_check
  CHECK (source_type IN ('rss', 'boamp', 'ted'));

ALTER TABLE tender_rss_matches
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS dedup_buyer TEXT;

UPDATE tender_rss_matches SET
  dedup_key = md5(nullif(regexp_replace(lower(extensions.unaccent(title)), '[^a-z0-9]+', '', 'g'), '')),
  dedup_buyer = md5(nullif(regexp_replace(lower(extensions.unaccent(coalesce(pouvoir_adjudicateur, ''))), '[^a-z0-9]+', '', 'g'), ''))
WHERE dedup_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_tender_rss_matches_tenant_dedup ON tender_rss_matches(tenant_id, dedup_key);
