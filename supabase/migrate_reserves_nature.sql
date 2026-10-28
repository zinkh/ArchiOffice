-- Nature d'une réserve d'OPR (EXE4 à EXE9) : épreuves, travaux non exécutés, imperfections et
-- malfaçons, repli du chantier et remise en état des lieux, pose des équipements. Elle ventile les
-- réserves dans les annexes numérotées des formulaires. Additive : NULL = nature non précisée.

ALTER TABLE reserves ADD COLUMN IF NOT EXISTS nature TEXT;
ALTER TABLE reserves DROP CONSTRAINT IF EXISTS reserves_nature_check;
ALTER TABLE reserves ADD CONSTRAINT reserves_nature_check
  CHECK (nature IS NULL OR nature IN ('epreuves', 'travaux', 'malfacons', 'installations', 'pose'));
