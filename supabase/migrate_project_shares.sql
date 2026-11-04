-- Partage d'une affaire avec un confrère (cotraitant, architecte associé).
--
-- Un collaborateur externe n'est PAS membre du cabinet : le partage est porté
-- par `project_shares` (une ligne par affaire × personne) et ses droits par
-- `project_share_grants` (une ligne par type de ressource). Aucun droit par
-- défaut : ce qui n'est pas accordé est invisible, pas seulement en lecture
-- seule. Le serveur fait barrière (server/projectShares/, server/guestAccessGuard.ts).
--
-- Idempotent : peut être rejoué sans effet.

CREATE TABLE IF NOT EXISTS project_shares (
  id            TEXT PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- TEXT sans FK, comme project_members.user_id : la personne vit dans auth.users.
  user_id       TEXT NOT NULL,
  email         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  invited_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  CONSTRAINT project_shares_status_check CHECK (status IN ('active', 'revoked')),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_shares_tenant_project ON project_shares(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_user           ON project_shares(user_id, status);

CREATE TABLE IF NOT EXISTS project_share_grants (
  id            TEXT PRIMARY KEY,
  share_id      TEXT NOT NULL REFERENCES project_shares(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  resource_kind TEXT NOT NULL,
  access        TEXT NOT NULL DEFAULT 'read',
  CONSTRAINT project_share_grants_access_check CHECK (access IN ('read', 'write')),
  UNIQUE (share_id, resource_kind)
);
CREATE INDEX IF NOT EXISTS idx_project_share_grants_share ON project_share_grants(share_id);

-- Isolation : toute la lecture et l'écriture passe par le serveur (rôle service,
-- qui contourne la RLS) ; la politique ferme l'accès direct par l'API REST.
ALTER TABLE project_shares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_share_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_shares;
CREATE POLICY "tenant_isolation" ON project_shares
  USING (tenant_id::text = my_tenant_id()::text);

DROP POLICY IF EXISTS "tenant_isolation" ON project_share_grants;
CREATE POLICY "tenant_isolation" ON project_share_grants
  USING (tenant_id::text = my_tenant_id()::text);
