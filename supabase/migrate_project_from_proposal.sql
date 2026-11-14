-- Migration : l'affaire créée à l'acceptation d'une proposition reprend TOUTES ses informations
--
-- (src/lib/proposalToProject.ts, PUT /api/proposals/:id). Les colonnes ci-dessous n'existaient que
-- côté proposition : nature de l'opération, surfaces existante et réhabilitée, ERP, parcelles
-- sélectionnées, plans et photos. `source_proposal_id` garde le lien vers la proposition d'origine
-- (sans clé étrangère, comme milestones.proposal_id : la proposition est archivée, jamais supprimée).
--
-- Additive et rejouable. Le rattrapage final ne remplit que des champs VIDES des affaires déjà
-- converties, appariées sans ambiguïté (même cabinet, même référence, même titre).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_proposal_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS operation_nature TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS surface_existante TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS surface_rehabilitee TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_erp BOOLEAN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parcelles_selection TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS illustrations TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_source_proposal ON projects(tenant_id, source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;

-- Rattrapage des affaires déjà converties.
WITH pairs AS (
  SELECT pr.id AS project_id, p.id AS proposal_id
    FROM projects pr
    JOIN proposals p ON p.tenant_id = pr.tenant_id AND p.status = 'Accepted'
                    AND p.reference IS NOT DISTINCT FROM pr.reference AND p.title = pr.name
   WHERE pr.source_proposal_id IS NULL
), unique_pairs AS (
  SELECT project_id, min(proposal_id) AS proposal_id
    FROM pairs GROUP BY project_id HAVING count(*) = 1
)
UPDATE projects pr SET
  source_proposal_id  = p.id,
  client_id           = COALESCE(pr.client_id, p.client_id),
  client_email        = COALESCE(pr.client_email, p.client_email),
  project_code        = COALESCE(pr.project_code, p.project_code),
  parcelles_selection = COALESCE(pr.parcelles_selection, p.parcelles_selection),
  operation_nature    = COALESCE(pr.operation_nature, p.operation_nature),
  surface_existante   = COALESCE(pr.surface_existante, p.surface_existante),
  surface_rehabilitee = COALESCE(pr.surface_rehabilitee, p.surface_rehabilitee),
  is_erp              = COALESCE(pr.is_erp, p.is_erp),
  illustrations       = COALESCE(pr.illustrations, p.illustrations),
  surface             = COALESCE(pr.surface, NULLIF(trim(p.surface_plancher), '')),
  nature_travaux_maf  = COALESCE(pr.nature_travaux_maf,
                          CASE p.operation_nature WHEN 'neuf' THEN 'Neuf' WHEN 'rehabilitation' THEN 'Réhabilitation' END)
  FROM unique_pairs u JOIN proposals p ON p.id = u.proposal_id
 WHERE pr.id = u.project_id;

-- Coût des travaux et rémunération : TEXT dans schema.sql, NUMERIC sur les bases plus anciennes. Le type
-- se lit sur la colonne elle-même pour que le rattrapage passe sur une installation neuve comme en production.
DO $$
DECLARE
  v_cost_type TEXT;
  v_remu_type TEXT;
BEGIN
  SELECT CASE WHEN data_type = 'text' THEN 'text' ELSE 'numeric' END INTO v_cost_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'construction_cost';
  SELECT CASE WHEN data_type = 'text' THEN 'text' ELSE 'numeric' END INTO v_remu_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'remuneration';
  EXECUTE format(
    'UPDATE projects pr SET
       construction_cost = COALESCE(pr.construction_cost, NULLIF(p.construction_cost, 0)::%s),
       remuneration      = COALESCE(pr.remuneration, NULLIF(p.amount, 0)::%s)
       FROM proposals p
      WHERE pr.source_proposal_id = p.id AND pr.tenant_id = p.tenant_id',
    v_cost_type, v_remu_type);
END $$;

-- Les réunions préparées sur la proposition rejoignent l'affaire (le lien à la proposition reste).
UPDATE meetings m SET project_id = pr.id
  FROM projects pr
 WHERE m.proposal_id = pr.source_proposal_id AND m.tenant_id = pr.tenant_id AND m.project_id IS NULL;
