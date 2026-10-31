-- Octets hébergés chez nous par personne ayant déposé un document, pour UN cabinet.
--
-- Alimente le cartouche « Stockage » de la barre latérale (GET /api/billing/storage).
-- Seuls les documents ont un auteur : `document_versions.uploaded_by` porte le NOM
-- de la personne (pas son identifiant). Les photos de réserves et de réunions, les
-- plans et les pièces jointes n'en ont pas ; l'écran les rapporte sous « non
-- attribué » par différence avec le total mesuré (tenant_storage_bytes).
--
-- Comme l'ancien plafond, ne compte que ce qui vit chez nous (storage_backend =
-- 'supabase') : un fichier sur l'espace externe du cabinet ne nous coûte rien.
-- Pas de dépendance au schéma `storage` : la fonction marche aussi sur le
-- Postgres local d'Electron.

CREATE OR REPLACE FUNCTION tenant_storage_by_uploader(p_tenant_id UUID)
RETURNS TABLE (uploaded_by TEXT, bytes BIGINT, files BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(btrim(v.uploaded_by), ''), '') AS uploaded_by,
         COALESCE(SUM(v.size_bytes), 0)::BIGINT          AS bytes,
         COUNT(*)::BIGINT                                AS files
    FROM document_versions v
   WHERE v.tenant_id = p_tenant_id
     AND v.storage_backend = 'supabase'
   GROUP BY 1
   ORDER BY 2 DESC;
$$;

-- Réservée au serveur : sans cela, n'importe quel compte connecté pourrait lire
-- la répartition de stockage d'un autre cabinet par l'API REST. Les rôles
-- Supabase n'existent pas sur le Postgres local d'Electron, d'où le test
-- d'existence.
REVOKE ALL ON FUNCTION tenant_storage_by_uploader(UUID) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION tenant_storage_by_uploader(UUID) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION tenant_storage_by_uploader(UUID) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION tenant_storage_by_uploader(UUID) TO service_role;
  END IF;
END $$;
