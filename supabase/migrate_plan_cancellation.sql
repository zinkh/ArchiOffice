-- Self-service subscription cancellation/downgrade (POST/DELETE
-- /api/billing/cancel in server/routes/billing.ts). pending_plan is the
-- target plan once the tenant's current paid-through period ends
-- (tenants.trial_ends_at, reused as a renewal date for paid plans) — applied
-- by server/planChanges.ts. No proration/refund: access at the current plan
-- continues until the already-paid-for period elapses.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_plan TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_change_requested_at TIMESTAMPTZ;
