-- Migration : Type de mission MAF sur proposals/projects
-- Permet de choisir le type de mission (intercalaire de la circulaire MAF)
-- dès le devis, puis de le reporter sur le projet et de le pré-remplir dans
-- le plugin Déclaration MAF.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS maf_intercalaire TEXT,
  ADD COLUMN IF NOT EXISTS taux_mission NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS part_interet NUMERIC(5,2);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS maf_intercalaire TEXT;
