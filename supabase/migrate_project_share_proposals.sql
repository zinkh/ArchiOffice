-- Partage d'affaire, tranche 3 : propositions de modification du CCTP et du DPGF.
--
-- Un confrère n'écrit jamais dans le document (dpgfs.data est un seul bloc JSON que
-- l'autosauvegarde de l'éditeur réécrit en entier) : il dépose une proposition, que le
-- cabinet valide. `base_value` est la valeur que le confrère a VUE ; à l'application, si
-- le champ a changé depuis, la proposition est refusée (« périmée ») plutôt que d'écraser
-- le travail fait entre-temps. Granularité : un champ d'un lot (titre), d'un chapitre
-- (texte, titre) ou d'un article (texte, désignation, quantité, prix unitaire, unité).
-- Aucune ligne n'est jamais supprimée : une proposition remplacée, retirée, refusée ou
-- périmée garde sa valeur de départ et sa valeur proposée.
--
-- Additive et rejouable : aucune donnée existante n'est modifiée.

CREATE TABLE IF NOT EXISTS project_share_proposals (
  id             TEXT PRIMARY KEY,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  share_id       TEXT NOT NULL REFERENCES project_shares(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL,
  project_lot_id TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  field          TEXT NOT NULL,
  base_value     TEXT NOT NULL DEFAULT '',
  proposed_value TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT project_share_proposals_status_check CHECK (status IN ('pending', 'applied', 'rejected', 'withdrawn', 'outdated')),
  CONSTRAINT project_share_proposals_target_check CHECK (target_type IN ('lot', 'chapitre', 'ligne')),
  CONSTRAINT project_share_proposals_field_check  CHECK (field IN ('cctpDescription', 'titre', 'designation', 'quantite', 'prixUnitaire', 'unite')),
  CONSTRAINT project_share_proposals_size_check   CHECK (
    char_length(proposed_value) <= 20000 AND char_length(base_value) <= 20000
    AND (decision_note IS NULL OR char_length(decision_note) <= 1000)
  )
);
CREATE INDEX IF NOT EXISTS idx_project_share_proposals_project ON project_share_proposals(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_proposals_share   ON project_share_proposals(share_id, status);

ALTER TABLE project_share_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON project_share_proposals;
CREATE POLICY "tenant_isolation" ON project_share_proposals
  USING (tenant_id::text = my_tenant_id()::text);
