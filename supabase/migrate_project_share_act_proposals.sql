-- Partage d'une affaire avec un confrère : modification de l'atelier ACT, PAR PROPOSITION.
--
-- La consultation (`act_data.consultation`) est un seul bloc JSON que l'éditeur de l'ACT réécrit en entier à
-- chaque enregistrement, et elle porte les offres et les montants des entreprises. Un confrère n'y écrit donc
-- jamais : il dépose une proposition, le cabinet l'approuve ou la refuse, et seule l'approbation écrit le bloc
-- (server/routes/projectShareActProposals.ts). Même principe que `project_share_proposals` pour le CCTP et le
-- DPGF, dans une table à part : celle-ci porte un lot obligatoire et un CHECK sur les champs du CCTP et du DPGF.
--
-- Clé d'un élément : `target_type` (offre ou entreprise consultée) et `target_id` (identifiant dans la
-- consultation). Liste de champs fermée, validée par le serveur ET par la base.
--
-- Additive et rejouable : aucune donnée existante n'est modifiée.

CREATE TABLE IF NOT EXISTS project_share_act_proposals (
  id             TEXT PRIMARY KEY,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  share_id       TEXT NOT NULL REFERENCES project_shares(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL,
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
  CONSTRAINT project_share_act_proposals_status_check CHECK (status IN ('pending', 'applied', 'rejected', 'withdrawn', 'outdated')),
  CONSTRAINT project_share_act_proposals_target_check CHECK (target_type IN ('offre', 'entreprise')),
  CONSTRAINT project_share_act_proposals_field_check  CHECK (field IN ('montant_base', 'note_technique', 'conforme', 'motif_nc', 'relance_le', 'ne_repond_pas')),
  CONSTRAINT project_share_act_proposals_size_check   CHECK (
    char_length(proposed_value) <= 2000 AND char_length(base_value) <= 2000
    AND (decision_note IS NULL OR char_length(decision_note) <= 1000)
  )
);
CREATE INDEX IF NOT EXISTS idx_project_share_act_proposals_project ON project_share_act_proposals(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_act_proposals_share   ON project_share_act_proposals(share_id, status);

-- Isolation : toute la lecture et l'écriture passe par le serveur (rôle service, qui contourne la RLS) ;
-- la politique ferme l'accès direct par l'API REST.
ALTER TABLE project_share_act_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON project_share_act_proposals;
CREATE POLICY "tenant_isolation" ON project_share_act_proposals
  USING (tenant_id::text = my_tenant_id()::text);
