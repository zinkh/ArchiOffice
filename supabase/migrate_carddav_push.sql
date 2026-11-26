-- Envoi ArchiOffice -> CardDAV (Nextcloud, kDrive, iCloud...), en plus de l'import existant.
-- Même principe que migrate_google_contacts_sync.sql : il faut pouvoir relier une fiche à la
-- vCard qui lui correspond (pour la mettre à jour au lieu de la recréer à chaque synchro, et
-- pour ne jamais écraser une modification faite côté serveur), et un réglage par cabinet pour
-- choisir les catégories envoyées.
--
-- Additive : une instance qui n'a pas encore cette migration continue d'importer comme avant
-- (la route CardDAV retombe sur les anciennes colonnes et n'envoie rien).

-- Adresse complète de la vCard sur le serveur (propre au carnet d'adresses synchronisé : une
-- adresse qui ne commence pas par le carnet choisi est ignorée, jamais réutilisée).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS carddav_href TEXT;
-- ETag de la vCard au dernier échange : si le serveur en annonce un autre, elle a changé depuis.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS carddav_etag TEXT;
-- Date du dernier échange ; une fiche modifiée après cette date a un envoi en attente.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS carddav_synced_at TIMESTAMPTZ;

-- Noms de catégories (contact_categories.name) envoyées vers CardDAV. Absent ou vide : rien
-- n'est envoyé, l'import n'est pas touché.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS carddav_sync_categories JSONB DEFAULT '[]'::jsonb;
