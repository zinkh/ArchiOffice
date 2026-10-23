-- Pré-tri IA de la veille des appels d'offres (RSS, BOAMP, TED).
--
-- L'IA lit les annonces détectées (tender_rss_matches), leur donne une note de
-- pertinence de 0 à 100 au regard des critères du cabinet, et attribue un
-- identifiant propre (AO-IA-AAAA-NNN) à celles qu'elle propose. Elle ne change
-- jamais le statut d'une annonce : écarter, surveiller ou convertir reste un
-- geste de l'architecte. Voir server/routes/tenderRssAi.ts.

ALTER TABLE tender_rss_matches
  ADD COLUMN IF NOT EXISTS ai_score      INTEGER,
  ADD COLUMN IF NOT EXISTS ai_verdict    TEXT,
  ADD COLUMN IF NOT EXISTS ai_reason     TEXT,
  ADD COLUMN IF NOT EXISTS ai_flags      JSONB,
  ADD COLUMN IF NOT EXISTS ai_ref        TEXT,
  ADD COLUMN IF NOT EXISTS ai_scored_at  TIMESTAMPTZ;

ALTER TABLE tender_rss_matches DROP CONSTRAINT IF EXISTS tender_rss_matches_ai_verdict_check;
ALTER TABLE tender_rss_matches ADD CONSTRAINT tender_rss_matches_ai_verdict_check
  CHECK (ai_verdict IS NULL OR ai_verdict IN ('pertinent', 'a_etudier', 'hors_cible'));

ALTER TABLE tender_rss_matches DROP CONSTRAINT IF EXISTS tender_rss_matches_ai_score_check;
ALTER TABLE tender_rss_matches ADD CONSTRAINT tender_rss_matches_ai_score_check
  CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100));

-- Un identifiant n'est porté que par une annonce proposée ; deux annonces d'un
-- même cabinet ne partagent jamais le leur. Index partiel : les annonces sans
-- identifiant (non notées ou hors cible) restent libres.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_rss_matches_ai_ref
  ON tender_rss_matches (tenant_id, ai_ref) WHERE ai_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tender_rss_matches_ai_score
  ON tender_rss_matches (tenant_id, ai_score DESC) WHERE ai_score IS NOT NULL;

-- Ce que le cabinet cherche, en texte libre : types d'opérations, zone
-- géographique, fourchette de travaux, ce qu'il refuse. Lu par l'IA à chaque
-- pré-tri ; vide, elle ne retient que le métier de maîtrise d'œuvre.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tender_ai_criteria TEXT;
