-- Maîtrise des documents MPRO §1.1.2
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indice TEXT DEFAULT 'A';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_statut TEXT DEFAULT 'en_cours';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS emetteur TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS approbateur TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS date_approbation TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type TEXT;

CREATE TABLE IF NOT EXISTS document_diffusions (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT,
  sent_at TEXT NOT NULL,
  acknowledged_at TEXT,
  notes TEXT
);
