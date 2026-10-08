-- Photos rattachées aux rubriques d'un compte-rendu de chantier : tableau d'URL,
-- comme `observations.photos`. Le PDF du CR les inclut selon un réglage de l'export.
ALTER TABLE site_report_notes ADD COLUMN IF NOT EXISTS photos TEXT[] NOT NULL DEFAULT '{}';
