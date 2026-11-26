-- Adresse du site du chantier d'un appel d'offres (carte, distance depuis l'agence
-- et isochrones de l'onglet Aperçu). Les coordonnées sont gardées avec l'adresse
-- pour ne pas géocoder à chaque ouverture de la fiche.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS adresse_terrain TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS site_lat DOUBLE PRECISION;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS site_lon DOUBLE PRECISION;
