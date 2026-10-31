-- Octets réellement hébergés chez nous pour UN cabinet, tous buckets métier.
--
-- Le plafond de stockage (server.ts::checkStorageQuota) et la jauge de l'écran
-- Abonnement ne sommaient que document_versions.size_bytes : les photos de
-- réserves et de réunions, les plans, les pièces jointes de messages et du fil
-- d'activité et les CV n'y entraient pas. Une limite à 5 ou 50 Go se
-- contournait donc par les photos. Tous ces buckets rangent leurs objets sous
-- `<identifiant du cabinet>/...` (vérifié en production : 216 objets sur 216).
--
-- Exclus volontairement : `logos` (identité visuelle, publique), `tenant-backups`
-- (sauvegardes de la plateforme, rétention de 30 jours) et `support-attachments`
-- (à notre charge, lus par le support). Un fichier déposé sur l'espace externe
-- du cabinet n'est jamais dans storage.objects : il n'est donc pas compté, ce
-- qui est voulu (voir server/externalStorage/storageUsage.ts).
--
-- Rend NULL quand le schéma `storage` n'existe pas (Postgres local d'Electron) :
-- l'appelant retombe alors sur l'ancien calcul.

CREATE OR REPLACE FUNCTION tenant_storage_bytes(p_tenant_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bytes BIGINT;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM((o.metadata->>'size')::BIGINT), 0)
    INTO v_bytes
    FROM storage.objects o
   WHERE o.bucket_id IN ('documents', 'plans', 'reserve-photos', 'meeting-photos',
                         'message-attachments', 'feed-attachments', 'cv')
     AND o.name LIKE p_tenant_id::text || '/%';

  RETURN v_bytes;
END;
$$;

-- Réservée au serveur : sans cela, n'importe quel compte connecté pourrait
-- lire le volume de stockage d'un autre cabinet par l'API REST. Les rôles
-- Supabase n'existent pas sur le Postgres local d'Electron, d'où le test
-- d'existence.
REVOKE ALL ON FUNCTION tenant_storage_bytes(UUID) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION tenant_storage_bytes(UUID) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION tenant_storage_bytes(UUID) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION tenant_storage_bytes(UUID) TO service_role;
  END IF;
END $$;
