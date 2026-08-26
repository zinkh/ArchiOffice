-- ============================================================
-- MIGRATION : Active le RLS manquant sur billing_events,
-- custom_references et project_members (audit de conformité —
-- ces 3 tables portaient tenant_id sans policy, laissant l'isolation
-- multi-tenant reposer uniquement sur le filtrage applicatif).
-- À exécuter dans le SQL Editor Supabase.
-- ============================================================

ALTER TABLE billing_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON billing_events;
CREATE POLICY "tenant_isolation" ON billing_events
  USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS "tenant_isolation" ON custom_references;
CREATE POLICY "tenant_isolation" ON custom_references
  USING (tenant_id = my_tenant_id());

-- project_members.tenant_id is TEXT on databases that ran the original
-- migrate_add_project_members.sql (it predates schema.sql declaring this
-- column UUID for fresh installs) — cast both sides so this policy works
-- regardless of which type this database actually has.
DROP POLICY IF EXISTS "tenant_isolation" ON project_members;
CREATE POLICY "tenant_isolation" ON project_members
  USING (tenant_id::text = my_tenant_id()::text);
