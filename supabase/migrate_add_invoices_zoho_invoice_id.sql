-- supabase/schema.sql has declared invoices.zoho_invoice_id since the Zoho
-- integration was written, but no migration ever added it to databases that
-- were provisioned before that line existed — so every already-running instance
-- is missing the column that the whole Zoho sync keys on.
--
-- The effect was a sync that silently did nothing, in both directions, while
-- reporting success: PostgREST answered 400 to every query naming the column,
-- and the route destructured only `data` (ignoring `error`), so a failed lookup
-- was indistinguishable from "no invoices matched":
--
--   GET /invoices?select=*,projects(name)&…&or=(zoho_invoice_id.is.null,…)  -> 400
--   GET /invoices?select=id,status,zoho_invoice_id&…&zoho_invoice_id=in.(…) -> 400
--
-- The first is the push (so nothing was ever sent to Zoho), the second the pull
-- (so no status ever came back, and no invoice was ever matched or imported).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zoho_invoice_id TEXT;

-- The pull looks invoices up by (tenant_id, zoho_invoice_id) on every sync.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_zoho_invoice_id
  ON invoices(tenant_id, zoho_invoice_id);
