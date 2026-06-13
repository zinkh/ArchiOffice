-- Migration: AI credit billing system
-- Run in Supabase SQL editor

-- 1. Balance en centimes EUR sur tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_credit_balance_eur_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_credit_last_refresh TIMESTAMPTZ;

-- 2. Colonnes supplémentaires sur agent_token_usage
ALTER TABLE agent_token_usage
  ADD COLUMN IF NOT EXISTS endpoint_type TEXT NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS input_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER;

-- Backfill cost_eur_cents (colonne existante, toujours NULL jusqu'ici)
UPDATE agent_token_usage SET cost_eur_cents = 0 WHERE cost_eur_cents IS NULL;

-- 3. Table billing_events (créée si absente) + colonne credit_pack_id
CREATE TABLE IF NOT EXISTS billing_events (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  event_type         TEXT NOT NULL,
  stancer_payment_id TEXT,
  plan_id            TEXT,
  amount             INTEGER,
  status             TEXT DEFAULT 'pending',
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_events
  ADD COLUMN IF NOT EXISTS credit_pack_id TEXT;

-- 4. Fonction atomique de recharge (évite race conditions)
CREATE OR REPLACE FUNCTION increment_ai_credits(p_tenant_id UUID, p_amount_cents INTEGER)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants
  SET ai_credit_balance_eur_cents = ai_credit_balance_eur_cents + p_amount_cents
  WHERE id = p_tenant_id;
$$;

-- 5. Fonction atomique de déduction (balance ne descend pas sous 0)
CREATE OR REPLACE FUNCTION deduct_ai_credits(p_tenant_id UUID, p_amount_cents INTEGER)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants
  SET ai_credit_balance_eur_cents = GREATEST(0, ai_credit_balance_eur_cents - p_amount_cents)
  WHERE id = p_tenant_id;
$$;

-- 6. Index pour les requêtes admin par tenant/date
CREATE INDEX IF NOT EXISTS idx_agent_token_usage_tenant_date
  ON agent_token_usage(tenant_id, created_at DESC);
