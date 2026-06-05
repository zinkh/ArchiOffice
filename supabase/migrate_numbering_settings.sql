-- Migration: Add document numbering prefix settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_prefix_devis TEXT DEFAULT 'DEVIS';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_prefix_facture TEXT DEFAULT 'FAC';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS num_prefix_honoraires TEXT DEFAULT 'NH';
