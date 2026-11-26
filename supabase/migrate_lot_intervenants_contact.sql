-- Intervenants des entreprises d'un lot : chaque intervenant est désormais une fiche contact de
-- l'agence (sélectionnée ou créée depuis l'onglet DET > Entreprises, comme dans Réunions).
-- Nom, téléphone et e-mail de la ligne restent un instantané, relu depuis la fiche à chaque lecture.
-- Les lignes saisies avant cette migration n'ont pas de contact_id et restent affichées. Idempotent.
ALTER TABLE lot_intervenants ADD COLUMN IF NOT EXISTS contact_id TEXT;
CREATE INDEX IF NOT EXISTS lot_intervenants_contact ON lot_intervenants(contact_id);
