-- Idempotency tracking for server/lifecycleEmails.ts — one column per
-- lifecycle email so the periodic check never sends the same notice twice.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ending_email_sent_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_expired_email_sent_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inactivity_email_sent_at TIMESTAMPTZ;
