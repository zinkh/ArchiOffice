-- ============================================================
-- Quantités à confirmer : réponses des entreprises depuis la page de dépôt (ACT)
-- ============================================================
-- Après le message « quantités à confirmer », l'entreprise répond poste par poste depuis son lien
-- personnel : elle reprend la quantité du dossier, maintient la sienne ou en propose une autre.
-- La réponse arrive ici et ne modifie JAMAIS l'offre : l'architecte l'applique depuis l'ACT.
-- Une seule réponse courante par poste et par entreprise (la dernière remplace la précédente).
-- Ajouts seulement, rien n'est modifié.

CREATE TABLE IF NOT EXISTS consultation_quantites_reponses (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  invite_id     UUID REFERENCES consultation_depot_invites(id) ON DELETE CASCADE NOT NULL,
  entreprise_id TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  -- Article du bordereau (Ligne.id) concerné.
  ligne_id      TEXT NOT NULL,
  choix         TEXT NOT NULL CHECK (choix IN ('moe', 'maintenue', 'autre')),
  -- Renseignée seulement pour le choix « autre ».
  quantite      NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invite_id, ligne_id)
);
CREATE INDEX IF NOT EXISTS idx_consultation_quantites_reponses_project
  ON consultation_quantites_reponses(tenant_id, project_id);

ALTER TABLE consultation_quantites_reponses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consultation_quantites_reponses;
CREATE POLICY tenant_isolation ON consultation_quantites_reponses
  USING (tenant_id = my_tenant_id());
