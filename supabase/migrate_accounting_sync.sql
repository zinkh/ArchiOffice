-- Fiabilise la numérotation des factures et la synchronisation comptable
-- (Zoho Invoice, Zoho Books, Odoo, et tout futur connecteur).
--
-- 1. Un cabinet choisit au plus UN connecteur comptable comme AUTORITÉ de
--    numérotation ("accounting_sync_provider" sur settings). Quand il est
--    actif, POST /api/invoices ne génère plus localement de numéro : la
--    facture part en brouillon sans "invoice_number", et c'est le
--    connecteur qui lui en attribue un (voir server/invoiceAccountingSync.ts).
--    NULL (ou 'none') signifie mode autonome — comportement inchangé.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS accounting_sync_provider TEXT;

-- 2. Le garde-fou qui manquait pour de vrai contre le double numérotage :
--    même avec une numérotation locale corrigée pour être moins encline aux
--    courses, seule une contrainte d'unicité en base empêche structurellement
--    deux factures du même cabinet de porter le même numéro. Index partiel
--    (WHERE ... IS NOT NULL) car une facture en cours de synchronisation
--    n'a justement pas encore de numéro, et un import Zoho/Odoo peut laisser
--    plusieurs lignes sans numéro le temps du premier envoi.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_invoice_number
  ON invoices(tenant_id, invoice_number) WHERE invoice_number IS NOT NULL;

-- 3. Modèle de synchro explicite, par connecteur — une table plutôt que des
--    colonnes sur `invoices` : un cabinet peut avoir plusieurs connecteurs
--    configurés au fil du temps (migration de Zoho vers Odoo, par exemple)
--    et cette table généralise à "tout nouveau plugin de comptabilité" sans
--    ajouter une colonne par connecteur à chaque fois.
CREATE TABLE IF NOT EXISTS invoice_accounting_sync (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  local_invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,
  external_invoice_id TEXT,
  invoice_number TEXT,
  -- pending: créée localement, pas encore confirmée côté connecteur.
  -- synced: le connecteur a confirmé (external_invoice_id + invoice_number posés).
  -- error: la tentative a échoué ; la facture reste sans numéro, à réessayer.
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  -- Clé stable envoyée au connecteur (reference_number Zoho, ref Odoo) : ce
  -- qui rend la création idempotente. Un même invoice_id ne doit produire
  -- qu'une facture côté connecteur même si l'appel est rejoué après une
  -- coupure réseau — voir server/invoiceAccountingSync.ts.
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(local_invoice_id, provider),
  UNIQUE(provider, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_invoice_accounting_sync_tenant ON invoice_accounting_sync(tenant_id);
