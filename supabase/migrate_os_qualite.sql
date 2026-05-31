-- Ordres de service MPRO §2.4.2
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS date_emission TEXT;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS date_ar TEXT;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS date_execution TEXT;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS emetteur_os TEXT;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS destinataire_os TEXT;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS notes_ar TEXT;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS delai_execution INTEGER;
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS delai_unit TEXT DEFAULT 'jours';
