-- Un confrère peut proposer le métré d'un article (la liste de lignes libellées dont la somme est la quantité).
-- Le champ proposable « metre » s'ajoute à la liste fermée des champs d'une proposition. Additive et
-- rejouable : les propositions existantes respectent déjà la nouvelle liste, rien n'est modifié.

ALTER TABLE project_share_proposals DROP CONSTRAINT IF EXISTS project_share_proposals_field_check;
ALTER TABLE project_share_proposals ADD CONSTRAINT project_share_proposals_field_check
  CHECK (field IN ('cctpDescription', 'titre', 'designation', 'quantite', 'prixUnitaire', 'unite', 'metre'));
