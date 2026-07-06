-- Align custom_references with the parameters available on projects
-- (maître d'ouvrage, domaine, dates, coûts, avancement) and add support
-- for free-form custom data on each reference.

ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS project_manager TEXT;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS construction_cost NUMERIC;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS remuneration NUMERIC;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS progression NUMERIC;
ALTER TABLE custom_references ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}'::jsonb;
