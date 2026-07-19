-- ============================================================
-- ArchiOffice — Migration : team_members.auth_user_id
-- ============================================================
-- server.ts looks up the current user's team_members row (display name,
-- notifications_last_seen) by their Supabase Auth id. That lookup was
-- filtering on a `user_id` column that was never actually created by any
-- committed migration — team_members.id is the row's own primary key, not
-- the auth id, so every call to getUserName()/the notifications endpoints
-- failed with "column team_members.user_id does not exist" (visible in
-- production logs on every activity-logging call, e.g. right after
-- creating a contact — the insert itself succeeded, but the follow-up
-- getUserName() call then threw, turning the whole request into a 500).
-- This column formalizes the auth-id link so lookups succeed.

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auth_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_team_members_auth_user ON team_members(auth_user_id, tenant_id);
