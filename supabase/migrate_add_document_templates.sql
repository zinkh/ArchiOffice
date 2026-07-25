-- Migration: Document templates library
-- Reusable French document templates (contrats, CCTP/DPGF skeletons, réponses AO,
-- courriers) with {{placeholder}} substitution. Every tenant gets its own private,
-- editable-by-duplication copy of a handful of starter templates, lazily inserted
-- by the server on a tenant's first GET /api/document_templates call (see
-- server/seedDocumentTemplates.ts) — kept out of this migration since large blocks
-- of markdown boilerplate are painful to review as SQL string literals, and this
-- avoids needing a nullable tenant_id "global" row that would break the
-- tenant_id NOT NULL + per-tenant RLS convention used everywhere else.

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Autre', -- 'Contrat MOE' | 'CCTP' | 'DPGF' | 'Candidature' | 'Courrier' | 'Autre'
  description TEXT,
  content TEXT NOT NULL,                  -- simple-markdown body with {{placeholder}} tokens
  variables JSONB NOT NULL DEFAULT '[]',  -- [{key,label,type,required,default_value}]
  is_seeded BOOLEAN NOT NULL DEFAULT false,
  editable BOOLEAN NOT NULL DEFAULT true, -- false for seeded originals (must Duplicate to customize)
  source_template_id TEXT REFERENCES document_templates(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_document_templates_tenant_category ON document_templates(tenant_id, category);

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON document_templates USING (tenant_id = my_tenant_id());
