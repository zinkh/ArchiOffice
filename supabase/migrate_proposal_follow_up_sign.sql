-- Additive, replayable. Existing Sent proposals have no invented send date.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_provider TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_request_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_status TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_recipient_email TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_recipient_name TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_sent_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_completed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signature_provider_region TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS signature_provider TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS zoho_sign_refresh_token TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS docuseal_api_key TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS docuseal_region TEXT NOT NULL DEFAULT 'eu';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS firma_workspace_id TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS firma_workspace_api_key TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS firma_workspace_state TEXT;
CREATE INDEX IF NOT EXISTS proposals_follow_up_due_idx ON proposals (tenant_id, next_follow_up_at)
  WHERE status = 'Sent' AND archived_at IS NULL AND last_response_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS proposals_signature_request_idx ON proposals (tenant_id, signature_provider, signature_request_id)
  WHERE signature_request_id IS NOT NULL;
