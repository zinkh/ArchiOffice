-- contact_categories et project_categories portaient une contrainte UNIQUE
-- (name) globale — reliquat d'avant le multi-tenant. Conséquence en
-- production : dès qu'un tenant utilisait un nom de catégorie déjà pris par
-- un AUTRE tenant (ex. "Fournisseur", "Client"), l'INSERT échouait avec
-- "duplicate key value violates unique constraint" et l'API renvoyait 500.
-- La contrainte doit être scopée par tenant : deux tenants peuvent avoir
-- chacun une catégorie "Fournisseur", mais un même tenant ne peut pas avoir
-- deux fois la même.

-- schema.sql now declares UNIQUE (tenant_id, name) inline on both tables (the
-- fix below, folded in for new installs), which auto-names the constraint
-- identically to what this migration adds explicitly — guard each ADD so a
-- fresh database (where schema.sql already created it) doesn't hit
-- "constraint already exists"; an existing database still missing it (the
-- original bug this migration fixes) gets it added as before.
ALTER TABLE contact_categories DROP CONSTRAINT IF EXISTS contact_categories_name_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_categories_tenant_id_name_key'
  ) THEN
    ALTER TABLE contact_categories ADD CONSTRAINT contact_categories_tenant_id_name_key UNIQUE (tenant_id, name);
  END IF;
END $$;

ALTER TABLE project_categories DROP CONSTRAINT IF EXISTS project_categories_name_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_categories_tenant_id_name_key'
  ) THEN
    ALTER TABLE project_categories ADD CONSTRAINT project_categories_tenant_id_name_key UNIQUE (tenant_id, name);
  END IF;
END $$;
