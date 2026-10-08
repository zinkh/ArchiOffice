-- Réponse apportée à une observation (entreprise, maîtrise d'œuvre) : texte libre, saisi dans
-- l'onglet Observations du chantier, qui est la vue de tout l'historique.
ALTER TABLE observations ADD COLUMN IF NOT EXISTS reponse TEXT;
