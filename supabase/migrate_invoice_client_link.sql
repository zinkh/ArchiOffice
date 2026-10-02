-- Migration: rattache une facture à un contact (Maître d'Ouvrage)
--
-- `invoices` n'avait jusqu'ici aucun lien vers `contacts` : le "client"
-- affiché sur une facture venait toujours du projet (project_id -> projects
-- -> client), et une facture sans projet (facture générale, ou importée
-- depuis un connecteur comptable) n'avait donc aucune identité de Maître
-- d'Ouvrage — ni nom, ni SIRET, ni adresse, ni téléphone. Une facture
-- française doit pourtant porter ces mentions pour le client comme pour le
-- vendeur (seller_* existent déjà sur cette table, voir schema.sql).
--
-- client_id ferme ce trou : rempli depuis projects.client_id à la création
-- quand l'un et l'autre existent, modifiable librement ensuite (comme
-- project_id) pour rattacher une facture générale ou une facture importée
-- d'un connecteur à un contact existant, ou pour corriger un contact que le
-- connecteur a créé à la volée sans toutes ses mentions légales.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
