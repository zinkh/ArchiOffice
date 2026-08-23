-- OAuth `state` nonces lived in a per-process Map (server/oauthState.ts), on the
-- assumption that "the whole authorization-code round trip completes within the
-- same server process". That does not hold in production: /api/<provider>/auth
-- and the provider's redirect back to /api/<provider>/callback are two
-- independent HTTP requests, and behind the load balancer they can land on
-- different containers — and a deploy or restart in between drops the nonce
-- either way. The callback then finds no matching state and refuses a
-- perfectly good grant ("La demande de connexion a expiré").
--
-- Moving the nonces here makes them visible to every instance. Affects all five
-- OAuth flows that share the helper: Zoho Invoice, Zoho Books, Google Calendar,
-- Gmail and Outlook.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  -- Set only by the per-user flows (Google Calendar, Gmail, Outlook — each team
  -- member connects their own account); the per-tenant Zoho flows leave it null.
  user_id TEXT,
  -- Where to send the browser after the callback, for the flows that start from
  -- an arbitrary project/contact page rather than a fixed one.
  return_to TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Expired rows are swept opportunistically on each new state.
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- Only ever read/written by the backend's service-role client, which bypasses
-- RLS. Enabling it with no policies means no anon or authenticated role can
-- reach these nonces directly — presenting someone else's state is exactly the
-- CSRF the nonce exists to prevent.
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
