-- Révision du document CCTP / DPGF (dpgfs.data).
--
-- Le document est un seul bloc JSON réécrit en entier par l'autosauvegarde de l'éditeur PRO.
-- Sans version, deux écrivains (deux onglets, un agent IA, l'approbation d'une proposition d'un
-- confrère) s'écrasent sans le savoir. Comparer la colonne `data` elle-même est impossible : elle
-- pèse plusieurs centaines de Ko et un filtre PostgREST passe dans l'URL.
--
-- `revision` est un compteur petit et comparable. Un déclencheur l'incrémente à chaque changement
-- réel de `data`, quel que soit l'écrivain (éditeur, agents, approbation, restauration d'un
-- instantané) : aucun chemin d'écriture ne peut l'oublier.
-- Additive et rejouable : un document existant démarre à 0.

ALTER TABLE dpgfs ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION dpgfs_bump_revision() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.data IS DISTINCT FROM OLD.data THEN
    NEW.revision := OLD.revision + 1;
  ELSE
    NEW.revision := OLD.revision;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dpgfs_bump_revision ON dpgfs;
CREATE TRIGGER dpgfs_bump_revision
  BEFORE UPDATE ON dpgfs
  FOR EACH ROW EXECUTE FUNCTION dpgfs_bump_revision();
