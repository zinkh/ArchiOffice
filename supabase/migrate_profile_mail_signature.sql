-- Signature de courrier, personnelle (une par personne, pas par cabinet, comme
-- profiles.show_personal_contacts) : ajoutée d'office au corps d'un nouveau
-- message ou d'une réponse rédigés depuis ArchiOffice, que la personne peut
-- toujours modifier ou retirer avant l'envoi. Texte brut, retours à la ligne
-- conservés.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mail_signature TEXT;
