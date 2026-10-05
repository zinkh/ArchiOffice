-- Saisies du calcul d'effectif ERP de la fiche affaire (onglet Infos, fiche complète).
--
-- Le type, la nature et la catégorie vivent déjà dans `type_et_cat`, et le résultat
-- dans `effectif_public` / `effectif_personnel`. Cette colonne garde ce qui a permis
-- d'y arriver : quantités par ligne de calcul, effectif déclaré, effectifs en sous-sol
-- et aux étages. NULL tant que rien n'a été saisi ; aucun backfill.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS erp_calcul JSONB;

COMMENT ON COLUMN projects.erp_calcul IS
  'Saisies du calcul d''effectif ERP de la fiche : quantites (par ligne), declare, sous_sol, etages. NULL tant que rien n''a été saisi.';
