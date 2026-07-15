-- Migration: Add (tenant_id, project_id) indexes for hot-path project-scoped queries
--
-- These tables are filtered by tenant_id + project_id together on nearly every
-- read (see GET /api/milestones, /api/invoices, /api/specifications,
-- /api/ordres_de_service, /api/visas, /api/receptions, /api/reserves,
-- /api/plans, /api/documents, /api/projects/:id/full, /api/dpgf/:projectId,
-- /api/situations/:projectId and the site-reports routes in server.ts) but had
-- no index beyond the primary key, forcing a full table scan per tenant as
-- data grows. document_versions and site_report_notes are looked up by
-- (tenant_id, <parent id>) instead of project_id.
--
-- Run this in your Supabase SQL editor or via supabase db push

CREATE INDEX IF NOT EXISTS idx_milestones_tenant_project ON milestones(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_project ON invoices(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_specifications_tenant_project ON specifications(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ordres_de_service_tenant_project ON ordres_de_service(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_site_reports_tenant_project ON site_reports(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_site_report_notes_tenant_report ON site_report_notes(tenant_id, report_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_project ON documents(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_tenant_document ON document_versions(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_visas_tenant_project ON visas(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_receptions_tenant_project ON receptions(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_plans_tenant_project ON plans(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_reserves_tenant_project ON reserves(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_dpgf_items_tenant_project ON dpgf_items(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_situations_tenant_project ON situations(tenant_id, project_id);
