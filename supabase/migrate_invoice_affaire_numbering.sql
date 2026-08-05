-- Double numérotation des factures d'acompte : le numéro séquentiel légal
-- (invoice_number, inchangé) reste la référence conforme à Zoho/Zoho Books ;
-- affaire_invoice_number est une référence métier complémentaire par affaire
-- (ex: "26014-ACO-02"), et phases porte la ventilation par phase de mission
-- avec son pourcentage d'avancement — même modèle que notes_honoraires.phases
-- (voir supabase/migrate_notes_honoraires.sql).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS affaire_invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phases jsonb DEFAULT '[]';
