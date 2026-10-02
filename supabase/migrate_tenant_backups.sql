-- Sauvegardes par cabinet, lisibles et restaurables par le superadmin seul.
--
-- Cas visé : un associé (ou un compte piraté) efface les données du cabinet.
-- Les sauvegardes globales de Supabase restaurent toute la plateforme, pas un
-- seul cabinet : celles-ci sont propres à chaque cabinet.
--
-- PAS DE CLÉ ÉTRANGÈRE VERS tenants, à dessein. Une sauvegarde doit survivre à
-- la suppression du cabinet : un ON DELETE CASCADE effacerait la sauvegarde
-- précisément dans le cas où on en a besoin.
--
-- Le contenu (lignes en JSON compressé, fichiers copiés) vit dans le bucket
-- privé `tenant-backups` (créé au démarrage par le serveur). Cette table n'en
-- porte que l'inventaire.
--
-- expires_at NULL = conservée jusqu'à décision du superadmin. C'est le cas des
-- sauvegardes prises à la suspension ou à la demande de fermeture d'un cabinet :
-- elles ne s'effacent pas d'elles-mêmes.
CREATE TABLE IF NOT EXISTS tenant_backups (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  tenant_name   TEXT,
  trigger       TEXT NOT NULL CHECK (trigger IN ('nightly', 'suspension', 'closure_request', 'manual')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
  data_path     TEXT,
  row_counts    JSONB,
  file_count    INTEGER NOT NULL DEFAULT 0,
  data_bytes    BIGINT NOT NULL DEFAULT 0,
  error         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_backups_tenant ON tenant_backups (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_backups_expiry ON tenant_backups (expires_at) WHERE expires_at IS NOT NULL;

-- Fichiers copiés dans le bucket de sauvegarde. Un fichier n'est copié qu'une
-- fois ; chaque sauvegarde met à jour `last_seen_at` pour ceux qu'elle voit
-- encore dans le stockage vivant. Un fichier supprimé du stockage vivant cesse
-- donc d'être « vu » et n'est retiré de la sauvegarde qu'à l'expiration de la
-- durée de conservation, ce qui laisse le temps de le restaurer.
CREATE TABLE IF NOT EXISTS tenant_backup_files (
  tenant_id     UUID NOT NULL,
  bucket        TEXT NOT NULL,
  path          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  backed_up_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, bucket, path)
);

CREATE INDEX IF NOT EXISTS idx_tenant_backup_files_seen ON tenant_backup_files (tenant_id, last_seen_at);

-- Service role uniquement : aucune politique, donc aucun accès par la clé
-- publique ni par un membre du cabinet, administrateurs compris.
ALTER TABLE tenant_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_backup_files ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE tenant_backups IS
  'Inventaire des sauvegardes par cabinet (superadmin uniquement). Pas de FK vers tenants : une sauvegarde survit à la suppression du cabinet.';
COMMENT ON COLUMN tenant_backups.expires_at IS
  'NULL = conservée jusqu''à décision du superadmin (sauvegardes de suspension et de demande de fermeture).';
