-- Contacts façon petit CRM : une personne peut être rattachée à une société
-- (fiche contact elle-même), et chaque fiche porte un statut de relation et un
-- rappel. Tout est facultatif : une fiche existante reste valide telle quelle.
--
--  * company_contact_id : société de rattachement (une société porte plusieurs
--    personnes). SET NULL à la suppression de la société : les personnes restent.
--  * relation_status    : prospect, en_discussion, client, partenaire, inactif.
--  * relation_reminder_on / relation_reminder_note : prochaine relance prévue.
--
-- merge_contacts (migrate_merge_contacts.sql) rattache company_contact_id.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relation_status TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relation_reminder_on DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relation_reminder_note TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_relation_status_check') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_relation_status_check
      CHECK (relation_status IS NULL OR relation_status IN ('prospect','en_discussion','client','partenaire','inactif'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(tenant_id, company_contact_id) WHERE company_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_reminder ON contacts(tenant_id, relation_reminder_on) WHERE relation_reminder_on IS NOT NULL;
