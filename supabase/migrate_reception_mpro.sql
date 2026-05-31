-- Migration: MPRO — Réception des travaux enrichie
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS reference_pv TEXT;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS lieu TEXT;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS signataires TEXT; -- JSON array of {nom, role}
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS observations TEXT;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS date_limite_levee TEXT; -- deadline global pour levée des réserves
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS pv_valide BOOLEAN DEFAULT false;
