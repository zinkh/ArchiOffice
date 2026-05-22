-- Migration: Add address/department to profiles + project_templates, act_data, det_data tables

-- Add missing columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department TEXT;

-- Add phase column to documents for auto-save by phase
ALTER TABLE documents ADD COLUMN IF NOT EXISTS phase TEXT;

-- Run this in the Supabase SQL editor on an existing database

-- Project Templates
CREATE TABLE IF NOT EXISTS project_templates (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_status TEXT DEFAULT 'Planning',
  default_budget NUMERIC DEFAULT 0,
  default_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON project_templates;
CREATE POLICY "tenant_isolation" ON project_templates
  USING (tenant_id = my_tenant_id());

-- ACT Data (Analyse Comparative des Offres)
CREATE TABLE IF NOT EXISTS act_data (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  companies JSONB DEFAULT '[]',
  lots JSONB DEFAULT '[]',
  scoring_criteria JSONB DEFAULT '[]',
  weights JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE act_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON act_data;
CREATE POLICY "tenant_isolation" ON act_data
  USING (tenant_id = my_tenant_id());

-- DET Data (Comptes Rendus de Réunions)
CREATE TABLE IF NOT EXISTS det_data (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  info JSONB DEFAULT '{}',
  observations JSONB DEFAULT '[]',
  intervenants JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE det_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON det_data;
CREATE POLICY "tenant_isolation" ON det_data
  USING (tenant_id = my_tenant_id());
