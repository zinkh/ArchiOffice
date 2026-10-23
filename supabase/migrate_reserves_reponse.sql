-- Suivi des réserves AOR (OPR et GPA) : réponse / commentaire de suivi.
-- Une réserve peut être faite sans être satisfaisante : ce texte libre, saisi dans la fiche de la
-- réserve, garde la réponse de l'entreprise ou la remarque de la maîtrise d'œuvre (ce qui reste à
-- reprendre, pourquoi la levée est refusée...), comme la réponse d'une observation du DET.
ALTER TABLE reserves     ADD COLUMN IF NOT EXISTS reponse TEXT;
ALTER TABLE gpa_reserves ADD COLUMN IF NOT EXISTS reponse TEXT;
