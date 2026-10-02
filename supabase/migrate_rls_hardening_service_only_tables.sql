-- Durcit trois tables accédées exclusivement côté serveur (supabaseAdmin,
-- qui contourne RLS de toute façon), signalées par l'advisor sécurité
-- Supabase (rls_disabled_in_public, ERROR) : sans RLS, PostgREST les
-- expose via la clé anon à quiconque la connaît, tenant_id ou pas. Même
-- correctif que celui appliqué à automation_api_keys/webhooks/
-- webhook_deliveries (migrate_automation_integrations.sql) — défense en
-- profondeur, aucun changement de comportement applicatif attendu.

ALTER TABLE invoice_accounting_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON invoice_accounting_sync;
CREATE POLICY "tenant_isolation" ON invoice_accounting_sync USING (tenant_id = my_tenant_id());

ALTER TABLE agent_mail_relay_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_mail_relay_tokens;
CREATE POLICY "tenant_isolation" ON agent_mail_relay_tokens USING (tenant_id = my_tenant_id());

ALTER TABLE agent_mail_inbox_processed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_mail_inbox_processed;
CREATE POLICY "tenant_isolation" ON agent_mail_inbox_processed USING (tenant_id = my_tenant_id());
