-- Optional file/image attachment on a support ticket message. See
-- server/routes/support.ts / adminSupport.ts and the new 'support-attachments'
-- private storage bucket (server.ts's ensureStorageBuckets,
-- server/storagePaths.ts's PRIVATE_STORAGE_BUCKETS).
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
