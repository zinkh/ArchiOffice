-- Migration: Add project_members table for per-project access control
-- Run this in your Supabase SQL editor or via supabase db push

CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  tenant_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- RLS policies (optional, enable if using RLS)
-- ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "tenant_isolation" ON project_members USING (tenant_id = auth.jwt()->>'tenant_id');

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_tenant_id ON project_members(tenant_id);
