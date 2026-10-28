-- Ordre manuel des plans d'une affaire (glisser-déposer dans le bloc Plans de l'onglet AOR).
-- Additive : NULL = jamais réordonné, le plan se classe alors par date de dépôt (le plus récent en tête).

ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order INTEGER;
