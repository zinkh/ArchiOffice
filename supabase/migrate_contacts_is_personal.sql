-- A "perso"/"pro" toggle on contacts, so a personal contact (family, a
-- friend entered for a birthday reminder, etc.) can be excluded from the
-- Google Contacts push sync (server/routes/contactSync.ts) without having to
-- manage it through the category vocabulary, which is used for other things
-- (Client/Entreprise/Cotraitant...) and not meant to double as this toggle.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;
