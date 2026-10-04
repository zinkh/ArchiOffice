-- Étude de faisabilité d'une proposition (volet « Étude de faisabilité » du
-- détail d'une proposition, src/components/proposal/FeasibilityStudy.tsx).
--
-- Même modèle que tender_methodology_notes (note méthodologique d'un appel
-- d'offres) : une ligne par rubrique, ordonnée par sort_order, rédigeable à
-- la main ou avec l'IA (POST /api/proposals/:id/feasibility/:sectionId/draft-ai,
-- server/routes/proposalFeasibilityAi.ts). Une seule étude par proposition :
-- l'étude EST l'ensemble des rubriques de la proposition, sans table parente.
--
-- illustrations : extraits de cartes insérés dans la rubrique, sous la forme
-- [{ document_id, file_url, layer, scale, caption, captured_at }]. L'image
-- elle-même est une ligne `documents` ordinaire (resource_type = 'proposals'),
-- composée côté navigateur depuis le WMS de l'IGN.
-- instructions : consigne libre de l'architecte transmise à l'IA pour cette
-- rubrique, jamais imprimée dans l'étude.

CREATE TABLE IF NOT EXISTS proposal_feasibility_sections (
  id            TEXT PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  proposal_id   TEXT REFERENCES proposals(id) ON DELETE CASCADE NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL DEFAULT '',
  illustrations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'a_rediger' CHECK (status IN ('a_rediger', 'redige')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proposal_feasibility_proposal
  ON proposal_feasibility_sections(tenant_id, proposal_id, sort_order);

ALTER TABLE proposal_feasibility_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON proposal_feasibility_sections;
CREATE POLICY "tenant_isolation" ON proposal_feasibility_sections
  USING (tenant_id = my_tenant_id());
