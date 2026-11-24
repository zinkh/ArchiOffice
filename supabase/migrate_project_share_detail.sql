-- Partage d'une affaire avec un confrère : un niveau de DÉTAIL par atelier de chantier (issue #688).
--
-- Un droit se donne par atelier (`project_share_grants`) : aucun accès, lecture, lecture et modification. Ce que
-- l'atelier cache encore (présences, suivi par lot et pénalités des comptes rendus, photos des rubriques et des
-- réserves, coordonnées des entreprises de l'ACT) s'ouvre par un indicateur `detail`, posé atelier par atelier
-- (`reports`, `reserves`, `gpa`, `act`). Il se combine à la lecture comme à la modification.
--
-- Aucun élargissement : toute ligne existante reste à FALSE, donc un partage déjà en place ne montre rien de plus
-- tant que le cabinet n'a pas coché le détail. Le code lit la colonne en tolérant son absence (instance non migrée :
-- aucun détail, jamais « tout »), cette migration peut donc passer avant ou après le déploiement.
--
-- Idempotent.

ALTER TABLE project_share_grants ADD COLUMN IF NOT EXISTS detail BOOLEAN NOT NULL DEFAULT FALSE;
