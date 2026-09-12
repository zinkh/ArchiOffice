-- Free multi-value tags on contacts, in the spirit of the existing
-- freeform `tags` field but structured (array, not a delimited string) so
-- the Contacts list can filter by a single value without parsing:
--   - corps_etat: shown/edited only for "Entreprise" contacts (building
--     trade — Électricité, Structure, Façades ITE, ...)
--   - specialite: shown/edited only for "Bureau d'études" contacts
--     (Economie, Fluides, BET TCE, AMO, ...)
-- Deliberately free text, not a foreign key into the existing
-- ref_corps_etat/ref_dtu nomenclature (Bibliothèque d'ouvrages) — that
-- nomenclature classifies building-trade norms, not a cabinet's own
-- contacts, and its vocabulary doesn't cover "Spécialité" at all.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS corps_etat JSONB DEFAULT '[]'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS specialite JSONB DEFAULT '[]'::jsonb;
