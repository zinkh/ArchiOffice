-- Idempotency tracking for the dunning follow-up reminder
-- (server/dunning.ts) — the immediate failure notice is sent synchronously
-- from the Stancer webhook (server/routes/billing.ts) and needs no such
-- guard, since each billing_events row only ever transitions pending->failed
-- once.
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS dunning_email_sent_at TIMESTAMPTZ;
