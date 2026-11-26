-- Partage d'une affaire avec un confrère : des droits PAR ATELIER, plus par lot.
--
-- Jusqu'ici le CCTP et le DPGF s'accordaient lot par lot (`project_share_grants.project_lot_id`). Un droit
-- se donne désormais pour l'atelier entier : aucun accès, lecture (et commentaire), lecture et modification.
-- Le code ignore toute ligne qui porte encore un lot (server/projectShares/access.ts, `loadGrants`) : refus par
-- défaut, jamais un accès plus large que celui qui avait été accordé.
--
-- Cette migration convertit ce qui peut l'être SANS ÉLARGIR l'accès : un atelier n'est accordé en entier que
-- lorsque TOUS les lots de l'affaire étaient déjà accordés (c'était le cas du seul partage existant en
-- production : 11 lots sur 11, pour le CCTP et pour le DPGF). Un partage qui n'ouvrait qu'une partie des lots
-- perd cet accès, et le cabinet le redonne au niveau de l'atelier s'il le souhaite. Le niveau retenu est le plus
-- haut des lots (lecture < commentaire < écriture).
--
-- À APPLIQUER APRÈS le déploiement du code des ateliers : l'ancien code ne lit pas les droits sans lot pour le CCTP
-- et le DPGF, le confrère concerné n'aurait plus accès à ces deux ateliers entre les deux.
--
-- Idempotent : une seconde exécution ne trouve plus aucune ligne par lot.

INSERT INTO project_share_grants (id, share_id, tenant_id, resource_kind, access, project_lot_id)
SELECT gen_random_uuid()::text, g.share_id, g.tenant_id, g.resource_kind,
       CASE max(CASE g.access WHEN 'write' THEN 2 WHEN 'comment' THEN 1 ELSE 0 END)
         WHEN 2 THEN 'write' WHEN 1 THEN 'comment' ELSE 'read' END,
       NULL
  FROM project_share_grants g
  JOIN project_shares s ON s.id = g.share_id
 WHERE g.project_lot_id IS NOT NULL
 GROUP BY g.share_id, g.tenant_id, g.resource_kind, s.project_id
HAVING count(DISTINCT g.project_lot_id) >= (SELECT count(*) FROM project_lots l WHERE l.project_id = s.project_id)
ON CONFLICT DO NOTHING;

DELETE FROM project_share_grants WHERE project_lot_id IS NOT NULL;
