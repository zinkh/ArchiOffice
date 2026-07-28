-- ============================================================
-- MIGRATION : Identité de l'architecte signataire (agence)
-- ============================================================
-- Utilisée par l'export PDF unifié des propositions (page de garde /
-- signatures) — remplace les noms d'architecte codés en dur qui
-- existaient dans les deux anciens générateurs PDF.
-- ============================================================

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS architect_name TEXT,
  ADD COLUMN IF NOT EXISTS oa_number TEXT;
