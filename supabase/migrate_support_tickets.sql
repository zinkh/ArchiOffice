-- In-app support channel between a tenant cabinet and the ArchiOffice
-- platform team. Deliberately NOT built on top of conversations/messages
-- (migrate_profile_and_messaging.sql) — those FK into profiles(id), which is
-- itself tenant-scoped, so a platform operator (who has no profiles row in
-- the tenant's own data) can't be a participant there without corrupting the
-- tenant data model. author_type distinguishes the two sides on
-- support_messages instead of a participants table.
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'answered' | 'closed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON support_tickets
  USING (tenant_id = my_tenant_id());
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON support_tickets(tenant_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  author_type TEXT NOT NULL, -- 'tenant' | 'platform'
  author_name TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON support_messages
  USING (tenant_id = my_tenant_id());
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at ASC);
