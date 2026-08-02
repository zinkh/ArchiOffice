-- Add ABF sector and programme fields used by the ProjectDetail overview
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS secteur_abf TEXT,
  ADD COLUMN IF NOT EXISTS programme TEXT;
