-- Veille RSS des appels d'offres — sources RSS déclarées par l'utilisateur,
-- filtrées par mots-clés, et annonces détectées par le sondage périodique.

CREATE TABLE IF NOT EXISTS tender_rss_sources (
  id                TEXT PRIMARY KEY,
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  include_keywords  JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclude_keywords  JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_polled_at    TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tender_rss_matches (
  id           TEXT PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  source_id    TEXT REFERENCES tender_rss_sources(id) ON DELETE CASCADE NOT NULL,
  guid         TEXT NOT NULL,
  title        TEXT NOT NULL,
  link         TEXT,
  description  TEXT,
  pub_date     TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'dismissed', 'converted')),
  tender_id    TEXT REFERENCES tenders(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_tender_rss_sources_tenant ON tender_rss_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tender_rss_matches_tenant_status ON tender_rss_matches(tenant_id, status);

ALTER TABLE tender_rss_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_rss_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON tender_rss_sources
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON tender_rss_matches
  USING (tenant_id = my_tenant_id());
