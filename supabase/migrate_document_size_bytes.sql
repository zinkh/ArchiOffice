-- Tracks the byte size of each uploaded document version so tenant storage
-- usage (storage_mb plan limit) can actually be enforced and displayed —
-- previously PLAN_LIMITS.storage_mb existed but nothing measured usage.
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
