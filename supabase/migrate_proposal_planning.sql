-- Propositions : planning prévisionnel réglé à la main (durées, décalages, flèches de dépendance).
-- planning : JSON { showDependencies: boolean, items: { [missionId]: { duree?: number, debut?: number } } }.
-- NULL = enchaînement par défaut des missions, tel que l'export le calcule (planifierCalendrier).
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planning TEXT;
