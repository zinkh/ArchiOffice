-- ============================================================
-- Accusés de réception des additifs au DCE (ACT)
-- ============================================================
-- Le mail d'un additif au DCE porte un lien « j'ai bien reçu » propre à chaque entreprise (ticket signé,
-- voir server/consultationDepot/accuseAdditif.ts). La confirmation s'enregistre ici, et non dans la
-- consultation (jsonb) : elle est posée par l'entreprise, hors de la session de l'architecte, et ne
-- doit pas être écrasée par l'enregistrement automatique de l'écran. Ajouts seulement.

CREATE TABLE IF NOT EXISTS consultation_additif_accuses (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  -- Identifiants DANS consultation (jsonb) : consultation.dce_revisions[].id et consultation.entreprises[].id.
  revision_id   TEXT NOT NULL,
  entreprise_id TEXT NOT NULL,
  entreprise_nom TEXT NOT NULL,
  accuse_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Une entreprise n'accuse réception d'un additif qu'une fois : le premier accusé fait foi.
CREATE UNIQUE INDEX IF NOT EXISTS consultation_additif_accuses_uniq
  ON consultation_additif_accuses(project_id, revision_id, entreprise_id);
CREATE INDEX IF NOT EXISTS idx_consultation_additif_accuses_project
  ON consultation_additif_accuses(tenant_id, project_id);

ALTER TABLE consultation_additif_accuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consultation_additif_accuses;
CREATE POLICY tenant_isolation ON consultation_additif_accuses
  USING (tenant_id = my_tenant_id());
