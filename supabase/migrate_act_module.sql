-- Migration: Module ACT étendu — gestion complète des appels d'offres travaux
ALTER TABLE act_data ADD COLUMN IF NOT EXISTS consultation jsonb DEFAULT '{}';
ALTER TABLE act_data ADD COLUMN IF NOT EXISTS act_phase text DEFAULT 'preparation';
