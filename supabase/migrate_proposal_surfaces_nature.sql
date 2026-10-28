-- Propositions : surfaces selon la nature de l'opération (neuf ou réhabilitation).
--
-- operation_nature     : 'neuf' | 'rehabilitation'. NULL = non renseigné (propositions
--                        antérieures) : l'écran la déduit du type de projet et des chiffres saisis.
-- surface_existante    : réhabilitation, surface du bâtiment existant (m², texte comme les autres surfaces).
-- surface_rehabilitee  : réhabilitation, part de l'existant réellement concernée par les travaux.
--
-- La surface de plancher (surface_plancher) reste la surface de l'opération après travaux et
-- l'extension (surface_plancher_ext) garde sa colonne.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS operation_nature TEXT,
  ADD COLUMN IF NOT EXISTS surface_existante TEXT,
  ADD COLUMN IF NOT EXISTS surface_rehabilitee TEXT;
