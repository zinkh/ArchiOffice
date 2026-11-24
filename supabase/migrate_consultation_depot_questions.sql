-- ============================================================
-- Questions des entreprises depuis la page de dépôt (ACT)
-- ============================================================
-- Une entreprise consultée peut poser une question depuis son lien personnel. La question arrive
-- ici (boîte de réception) ; le cabinet la reprend dans consultation.questions (jsonb), où la
-- réponse est saisie et où elle fait foi. Une question est « intégrée » quand son id figure dans
-- consultation.questions : aucun statut à tenir ici. Ajouts seulement, rien n'est modifié.

CREATE TABLE IF NOT EXISTS consultation_depot_questions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  invite_id     UUID REFERENCES consultation_depot_invites(id) ON DELETE CASCADE NOT NULL,
  entreprise_id TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  -- Lot visé (project_lots.id) ; NULL = question générale.
  lot_id        TEXT,
  objet         TEXT,
  question      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consultation_depot_questions_project
  ON consultation_depot_questions(tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultation_depot_questions_invite
  ON consultation_depot_questions(invite_id);

ALTER TABLE consultation_depot_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consultation_depot_questions;
CREATE POLICY tenant_isolation ON consultation_depot_questions
  USING (tenant_id = my_tenant_id());

-- Présence à la visite de site confirmée par l'entreprise depuis sa page (jamais écrite dans la
-- consultation : l'architecte reste seul maître du pointage des présences).
ALTER TABLE consultation_depot_invites ADD COLUMN IF NOT EXISTS visite_confirmee_le TIMESTAMPTZ;
