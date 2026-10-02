-- Suspension d'un cabinet par le superadmin plateforme.
--
-- Cas visé : un litige entre associés, un compte administrateur piraté ou
-- malveillant. Un cabinet suspendu est bloqué pour TOUS ses membres, y compris
-- ses administrateurs : plus personne ne peut lire, modifier, supprimer ni
-- exporter. Seul le superadmin peut lever la suspension (back-office).
--
-- La suspension ne supprime rien. Les données sont conservées intactes, et
-- aucune purge automatique ne s'applique à un cabinet suspendu
-- (server/tenantPurge.ts les ignore).
--
-- suspension_reason est obligatoire côté serveur : il porte le motif ET le
-- justificatif (accord écrit des associés, décision de justice...).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_by UUID;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- Le middleware ne relit que les cabinets suspendus (une poignée au plus).
CREATE INDEX IF NOT EXISTS idx_tenants_suspended
  ON tenants (suspended_at) WHERE suspended_at IS NOT NULL;

COMMENT ON COLUMN tenants.suspended_at IS
  'Date de suspension du cabinet par le superadmin. NULL = cabinet actif. Un cabinet suspendu est inaccessible à tous ses membres.';
COMMENT ON COLUMN tenants.suspended_by IS
  'Superadmin qui a suspendu le cabinet.';
COMMENT ON COLUMN tenants.suspension_reason IS
  'Motif et justificatif de la suspension (accord écrit des associés, décision de justice...).';
