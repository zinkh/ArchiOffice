-- Double numérotation des factures d'acompte : le numéro séquentiel légal
-- (invoice_number, inchangé) reste la référence conforme à Zoho/Zoho Books ;
-- affaire_invoice_number est une référence métier complémentaire par affaire
-- (ex: "26014-ACO-02"), et phases porte la ventilation par phase de mission
-- avec son pourcentage d'avancement — même modèle que notes_honoraires.phases
-- (voir supabase/migrate_notes_honoraires.sql).
--
-- invoice_type/mission_id/mission_name/advancement_pct sont la fonctionnalité
-- "facture d'acompte" préexistante — présente dans schema.sql mais jamais
-- livrée via un migrate_*.sql dédié. On les inclut ici (IF NOT EXISTS, donc
-- sans effet si déjà appliquées ailleurs) pour que les bases qui n'avaient
-- que le schéma pré-acompte rattrapent aussi cette fonctionnalité de base,
-- dont la double numérotation dépend.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type TEXT DEFAULT 'standard';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS mission_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS mission_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS advancement_pct NUMERIC DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS affaire_invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phases jsonb DEFAULT '[]';
