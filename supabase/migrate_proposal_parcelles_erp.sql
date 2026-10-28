-- Propositions : sélection de parcelles cadastrales persistante et opération ERP.
--
-- parcelles_selection : JSON (texte, comme miqcp_assessment) des parcelles cochées
--   sur la carte (id, section, numéro, préfixe, commune, INSEE, contenance, géométrie),
--   pour que le cadre autour du terrain survive à la fermeture de la proposition.
-- is_erp : l'opération est un établissement recevant du public. NULL = non renseigné
--   (propositions antérieures) : l'écran le déduit alors des champs ERP déjà saisis.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS parcelles_selection TEXT,
  ADD COLUMN IF NOT EXISTS is_erp BOOLEAN;
