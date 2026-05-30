-- Add missing terrain BAN/city_code columns to proposals table
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS ban_id_terrain TEXT,
  ADD COLUMN IF NOT EXISTS city_code_terrain TEXT;
