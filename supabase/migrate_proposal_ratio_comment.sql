-- Commentaire libre accompagnant les ratios de coût (€/m²) d'une proposition, imprimé dans l'export PDF
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS ratio_comment TEXT;
