-- ============================================================
-- MIGRATION : Demandes de rattachement à une agence existante
-- À exécuter dans le SQL Editor Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS join_requests (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES auth.users(id)
);

-- Un seul rattachement en attente à la fois par utilisateur
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_pending_user_idx
  ON join_requests(user_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS join_requests_tenant_idx ON join_requests(tenant_id);

ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON join_requests;
CREATE POLICY tenant_isolation ON join_requests
  USING (tenant_id = my_tenant_id() OR user_id = auth.uid());
