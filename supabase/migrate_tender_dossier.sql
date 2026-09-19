-- ── Dossier de candidature d'un appel d'offres ───────────────────────────────
--
-- La fiche détaillée d'un appel d'offres (src/pages/TenderDetail.tsx) n'avait
-- jusqu'ici aucune donnée réelle au-delà de tenders/tender_specialties/
-- milestones : son "organigramme" était un arbre entièrement fictif (faux
-- salariés, faux budgets), jamais relié à mandataire_id/specialties_list.
-- Cette migration ajoute ce qui manquait pour une vraie fiche à onglets :
--
-- 1. tenders.description — le texte de présentation de l'affaire, distinct de
--    `notes` (déjà un champ libre à un autre usage).
-- 2. tender_competitors — concurrents pressentis (nom, info, niveau de
--    risque). Le stat "Candidats" de l'en-tête est calculé depuis cette
--    liste (COUNT), pas un champ manuel séparé — une seule source de vérité.
-- 3. tender_evaluation_criteria — critères de jugement des offres, pondérés
--    en %. Gérée comme tender_specialties/milestones : purge + réinsertion
--    complète à chaque sauvegarde de la fiche (POST/PUT /api/tenders/:id).
-- 4. tender_pieces — pièces demandées par le règlement de consultation
--    (candidature/offre technique/offre financière), avec un statut qui
--    distingue une pièce à fournir, déjà fournie, ou détectée automatiquement
--    par l'analyse IA du DCE (statut 'detectee_ia', jamais 'fournie' tant que
--    personne ne l'a confirmée). Le stat "Pièces à fournir X/Y" de l'en-tête
--    se calcule dessus.
-- 5. tender_references — sélection, parmi les références du cabinet
--    (projets ou custom_references), de celles jointes à CETTE candidature,
--    avec un repère "exigée par le règlement" indépendant de la sélection.
-- 6. tender_methodology_notes — les sections de la note méthodologique
--    (mémoire technique), rédigeables à la main ou par IA.
-- 7. tender_activity_notes — journal de suivi en texte libre, horodaté,
--    ajout seul (pas d'édition a posteriori).

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS tender_competitors (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id   TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  info        TEXT,
  risk_level  TEXT NOT NULL DEFAULT 'moyen' CHECK (risk_level IN ('faible', 'moyen', 'eleve')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_competitors_tender ON tender_competitors(tenant_id, tender_id);

CREATE TABLE IF NOT EXISTS tender_evaluation_criteria (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id   TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  label       TEXT NOT NULL,
  weight_pct  NUMERIC NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tender_eval_criteria_tender ON tender_evaluation_criteria(tenant_id, tender_id);

CREATE TABLE IF NOT EXISTS tender_pieces (
  id                 TEXT PRIMARY KEY,
  tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id          TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  section            TEXT NOT NULL DEFAULT 'candidature' CHECK (section IN ('candidature', 'offre_technique', 'offre_financiere')),
  label              TEXT NOT NULL,
  obligatoire        BOOLEAN NOT NULL DEFAULT TRUE,
  quantity_required  INTEGER,
  status             TEXT NOT NULL DEFAULT 'a_fournir' CHECK (status IN ('a_fournir', 'fournie', 'detectee_ia')),
  source_hint        TEXT,
  document_id        TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_pieces_tender ON tender_pieces(tenant_id, tender_id);

CREATE TABLE IF NOT EXISTS tender_references (
  id                   TEXT PRIMARY KEY,
  tenant_id            UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id            TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  project_id           TEXT REFERENCES projects(id) ON DELETE CASCADE,
  custom_reference_id  UUID REFERENCES custom_references(id) ON DELETE CASCADE,
  required             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (project_id IS NOT NULL OR custom_reference_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tender_references_tender ON tender_references(tenant_id, tender_id);

CREATE TABLE IF NOT EXISTS tender_methodology_notes (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id   TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'a_rediger' CHECK (status IN ('a_rediger', 'redige')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_methodology_tender ON tender_methodology_notes(tenant_id, tender_id, sort_order);

CREATE TABLE IF NOT EXISTS tender_activity_notes (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id   TEXT REFERENCES tenders(id) ON DELETE CASCADE NOT NULL,
  author_name TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_activity_notes_tender ON tender_activity_notes(tenant_id, tender_id, created_at);

ALTER TABLE tender_competitors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_evaluation_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_pieces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_references         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_methodology_notes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_activity_notes     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON tender_competitors;
CREATE POLICY "tenant_isolation" ON tender_competitors
  USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON tender_evaluation_criteria;
CREATE POLICY "tenant_isolation" ON tender_evaluation_criteria
  USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON tender_pieces;
CREATE POLICY "tenant_isolation" ON tender_pieces
  USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON tender_references;
CREATE POLICY "tenant_isolation" ON tender_references
  USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON tender_methodology_notes;
CREATE POLICY "tenant_isolation" ON tender_methodology_notes
  USING (tenant_id = my_tenant_id());
DROP POLICY IF EXISTS "tenant_isolation" ON tender_activity_notes;
CREATE POLICY "tenant_isolation" ON tender_activity_notes
  USING (tenant_id = my_tenant_id());
