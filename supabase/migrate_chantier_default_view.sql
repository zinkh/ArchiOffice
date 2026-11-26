-- Vue par défaut des listes de chantier (CR de chantier, AOR, GPA).
-- Réglage du cabinet : 'reserves' (réserves), 'open' (observations ouvertes)
-- ou 'all' (toutes les observations). 'all' reproduit le comportement antérieur.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS chantier_default_view TEXT NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_chantier_default_view_check') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_chantier_default_view_check
      CHECK (chantier_default_view IN ('reserves', 'open', 'all'));
  END IF;
END $$;
