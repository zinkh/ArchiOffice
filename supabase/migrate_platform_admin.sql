-- Real, DB-backed superadmin role (replaces the sole SUPER_ADMIN_EMAIL env
-- var check in server/routes/superAdmin.ts). Deliberately a separate table
-- rather than a new profiles.system_role value: system_role already means
-- "admin of one's own tenant" everywhere it's checked (=== 'admin', not
-- !== 'user'), so a third value there risks either failing those checks
-- silently or, worse, a loosened check wrongly granting tenant-admin powers
-- to a platform operator inside a tenant they don't belong to.
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Audit trail for every mutating action taken from the platform back-office
-- (server/routes/superAdmin.ts) — plan changes, AI credit adjustments,
-- tenant creation/deletion, superadmin grants/revokes. No tenant_isolation
-- policy applies (this table isn't tenant-scoped); only the service-role
-- key (supabaseAdmin) is meant to read/write it, hence RLS with no policy.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_tenant ON admin_audit_log(target_tenant_id, created_at DESC);

-- Free-text internal notes a platform operator keeps on a tenant (CRM-style),
-- surfaced on the new tenant detail drill-down (GET /api/admin/tenants/:id).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS internal_notes TEXT;
