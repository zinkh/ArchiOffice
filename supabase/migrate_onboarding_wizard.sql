-- Migration: Onboarding wizard support
-- Adds the fields needed by the "New cabinet setup" wizard (src/pages/Onboarding.tsx):
-- an APE/NAF code alongside the existing SIRET, a configurable numbering prefix for
-- projects ("affaires") to match the existing devis/facture/honoraires prefixes, and
-- a default-template flag per category so a tenant can mark one CCTP and one OS
-- (ordre de service) template as its default.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS ape TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_prefix_affaire TEXT;

ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_templates_one_default_per_category
  ON document_templates(tenant_id, category) WHERE is_default = true;
