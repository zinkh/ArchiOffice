-- Plan et photos d'une proposition : extraits de cartes IGN et photos insérés dans le
-- document exporté (section « Plan et photos », activable dans l'éditeur de modèle).
-- illustrations : JSON (texte, comme parcelles_selection) d'une liste
--   [{ document_id, file_url, layer, scale, caption, captured_at }], la même forme que
--   les illustrations d'une rubrique d'étude de faisabilité. Chaque image est une ligne
--   `documents` de la proposition ; NULL = aucune illustration.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS illustrations TEXT;
