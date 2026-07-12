-- Sync infrastructure for the offline desktop build's cloud-link feature
-- (create a local Postgres install linked to an existing cloud tenant, with
-- ongoing two-way sync). Purely additive: new columns default to NOW() and
-- backfill existing rows, new triggers only add a row to a new sync_log
-- table on write, new table/function/policy are all IF NOT EXISTS /
-- CREATE OR REPLACE. Zero behavior change for the existing web app.
--
-- Scope (SYNC_TABLES, mirrored in server/syncTables.ts) is an explicit
-- allow-list, not "every table" — verified against the live schema before
-- writing this migration (the static schema.sql file references
-- activities/feed_posts/feed_comments tables that do not actually exist in
-- production, and several tables the file suggested already had updated_at
-- did not — ADD COLUMN IF NOT EXISTS makes this safe either way). Excluded
-- on purpose:
--   - tenants, profiles: provisioned once at cloud-link time with IDs
--     copied verbatim from the cloud row, not tracked via the generic
--     trigger (their identity *is* the link, not sync payload).
--   - agents, agent_conversations, agent_messages, agent_token_usage:
--     AI-agent template/chat data, out of scope for v1 tenant-data sync.
--   - billing_events: cloud-only billing/Stripe data, no offline use.
--   - project_categories_junction, project_team, observation_reports: pure
--     junction tables with no tenant_id/id column of their own (composite
--     PK) — synced via their owning parent row instead of this generic
--     mechanism (server/initialImport.ts / server/cloudSync.ts).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS sync_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  row_data    JSONB,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reserved for future use (which install produced a change, for
  -- diagnostics). Anti-echo suppression in v1 is done client-side (a
  -- short-lived in-memory "recently pushed" set in server/cloudSync.ts)
  -- rather than here, since PostgREST/anon-key REST calls have no simple
  -- way to thread a per-request session GUC into this trigger.
  origin      TEXT NOT NULL DEFAULT 'cloud'
);

CREATE INDEX IF NOT EXISTS idx_sync_log_tenant_watermark ON sync_log(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_sync_log_logged_at ON sync_log(logged_at);

ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_log_select_own_tenant ON sync_log;
CREATE POLICY sync_log_select_own_tenant ON sync_log
  FOR SELECT
  USING (tenant_id = my_tenant_id());

-- SECURITY DEFINER: this must be able to insert into sync_log regardless of
-- the calling user's own grants on sync_log itself (there are intentionally
-- no INSERT/UPDATE/DELETE policies for authenticated/anon — only this
-- trigger, running as the function owner, ever writes to sync_log).
-- SET search_path pins name resolution and avoids the classic
-- search-path-hijack risk that comes with SECURITY DEFINER.
CREATE OR REPLACE FUNCTION log_sync_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  -- A handful of in-scope tables (e.g. notes_honoraires) allow a NULL
  -- tenant_id for orphan/global rows — sync_log.tenant_id is NOT NULL, so
  -- such rows simply aren't sync-tracked rather than failing the write.
  IF v_tenant_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO sync_log (tenant_id, table_name, row_id, op, row_data)
  VALUES (
    v_tenant_id,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id)::text,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach updated_at + both triggers to every in-scope table. Re-runnable:
-- ADD COLUMN IF NOT EXISTS is a no-op where the column already exists
-- (act_data, contrats_moe, maf_project_data, marches_entreprises,
-- notes_honoraires already had a manually-set updated_at — the new trigger
-- now maintains it automatically instead going forward), and
-- DROP TRIGGER IF EXISTS + CREATE avoids duplicate-trigger errors on re-run
-- (Postgres has no CREATE TRIGGER IF NOT EXISTS).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'act_data', 'articles_type', 'cctps', 'contact_categories', 'contacts',
    'contrats_moe', 'custom_references', 'det_data', 'detail_situations',
    'document_versions', 'documents', 'dpgf_items', 'dpgfs', 'invoice_items',
    'invoices', 'lignes_ouvrages', 'maf_project_data', 'marches_entreprises',
    'milestones', 'notes_honoraires', 'observations', 'ordres_de_service',
    'plans', 'project_categories', 'project_cotraitants', 'project_lots',
    'project_members', 'project_stakeholders', 'project_templates',
    'projects', 'proposal_specialties', 'proposals', 'receptions',
    'reserves', 'settings', 'site_report_notes', 'site_reports',
    'situations', 'specifications', 'tasks', 'team_members',
    'tender_specialties', 'tenders', 'visas'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_sync_change ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_log_sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_sync_change()',
      t
    );
  END LOOP;
END;
$$;
