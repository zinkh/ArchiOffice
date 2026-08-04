-- ============================================================
-- MIGRATION : Conformité RGPD — consentement à l'inscription et
-- fermeture de cabinet (droit à l'effacement, purge automatisée)
-- À exécuter dans le SQL Editor Supabase
-- ============================================================

-- Horodatage du consentement à la politique de confidentialité / CGU,
-- capturé à l'inscription (case à cocher obligatoire, voir Register.tsx).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Fermeture de cabinet à la demande de l'administrateur : délai de grâce de
-- 30 jours (annulable) avant purge automatisée définitive du tenant et de
-- toutes ses données (server/tenantPurge.ts).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
