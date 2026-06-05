-- Migration: Fix construction_cost column name + add ratio fields for Montant des travaux
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS construction_cost NUMERIC DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS ratio_rehab NUMERIC DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS ratio_extension NUMERIC DEFAULT 0;

-- Migrate existing data from construction_cost_num to construction_cost
UPDATE proposals SET construction_cost = construction_cost_num WHERE construction_cost_num IS NOT NULL AND construction_cost = 0;
