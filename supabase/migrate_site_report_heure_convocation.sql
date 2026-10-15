-- Heure de convocation par défaut d'un compte-rendu de chantier (HH:MM), commune à tous les
-- lots ; chaque lot peut la remplacer par la sienne (`lot_tracking[].heure`, jsonb existant).
-- Colonne facultative : une base qui ne l'a pas encore lit et écrit les comptes-rendus comme avant
-- (server/routes/siteReports.ts n'écrit la colonne que si la requête porte le champ).
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS heure_convocation TEXT;
