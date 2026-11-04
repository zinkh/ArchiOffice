-- Partage d'affaire, tranche 2 : droits par lot, niveau « commentaire », commentaires.
--
-- Le CCTP et le DPGF sont UN document dont chaque lot porte textes et prix
-- (dpgfs.data). Le droit sur l'un ou l'autre se donne donc lot par lot, clé
-- `project_lots.id`, pour qu'un lot n'ouvre jamais les prix des autres.
--
-- Additive et rejouable : aucune donnée existante n'est modifiée.

ALTER TABLE project_share_grants ADD COLUMN IF NOT EXISTS project_lot_id TEXT;

-- Un même type peut maintenant figurer pour plusieurs lots : l'unicité devient
-- (partage, type, lot), le lot absent comptant pour une valeur.
ALTER TABLE project_share_grants DROP CONSTRAINT IF EXISTS project_share_grants_share_id_resource_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_share_grants_share_kind_lot
  ON project_share_grants (share_id, resource_kind, COALESCE(project_lot_id, ''));

-- lire < commenter < écrire.
ALTER TABLE project_share_grants DROP CONSTRAINT IF EXISTS project_share_grants_access_check;
ALTER TABLE project_share_grants ADD CONSTRAINT project_share_grants_access_check
  CHECK (access IN ('read', 'comment', 'write'));

-- Commentaires d'un confrère sur un lot, un chapitre ou un article, et réponses du cabinet.
-- Un fil appartient à UN partage : un confrère ne lit jamais les fils d'un autre.
CREATE TABLE IF NOT EXISTS project_share_comments (
  id             TEXT PRIMARY KEY,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  share_id       TEXT NOT NULL REFERENCES project_shares(id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES project_share_comments(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL,
  author_kind    TEXT NOT NULL,
  resource_kind  TEXT NOT NULL,
  project_lot_id TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    TEXT,
  CONSTRAINT project_share_comments_author_kind_check CHECK (author_kind IN ('guest', 'cabinet')),
  CONSTRAINT project_share_comments_resource_check CHECK (resource_kind IN ('cctp', 'dpgf')),
  CONSTRAINT project_share_comments_target_check CHECK (target_type IN ('lot', 'chapitre', 'ligne')),
  CONSTRAINT project_share_comments_body_check CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_project_share_comments_project ON project_share_comments(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_comments_share   ON project_share_comments(share_id);

ALTER TABLE project_share_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON project_share_comments;
CREATE POLICY "tenant_isolation" ON project_share_comments
  USING (tenant_id::text = my_tenant_id()::text);
