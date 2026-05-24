-- Billing: Stancer payment columns for tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stancer_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stancer_subscription_id TEXT;

-- Billing events: payment history per tenant
CREATE TABLE IF NOT EXISTS billing_events (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  event_type   TEXT NOT NULL,
  stancer_payment_id TEXT,
  plan_id      TEXT,
  amount       INTEGER, -- in EUR cents
  status       TEXT DEFAULT 'pending', -- pending | paid | failed | refunded
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON billing_events
  FOR ALL USING (tenant_id = my_tenant_id());
