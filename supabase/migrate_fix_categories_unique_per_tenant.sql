-- contact_categories et project_categories portaient une contrainte UNIQUE
-- (name) globale — reliquat d'avant le multi-tenant. Conséquence en
-- production : dès qu'un tenant utilisait un nom de catégorie déjà pris par
-- un AUTRE tenant (ex. "Fournisseur", "Client"), l'INSERT échouait avec
-- "duplicate key value violates unique constraint" et l'API renvoyait 500.
-- La contrainte doit être scopée par tenant : deux tenants peuvent avoir
-- chacun une catégorie "Fournisseur", mais un même tenant ne peut pas avoir
-- deux fois la même.

ALTER TABLE contact_categories DROP CONSTRAINT IF EXISTS contact_categories_name_key;
ALTER TABLE contact_categories ADD CONSTRAINT contact_categories_tenant_id_name_key UNIQUE (tenant_id, name);

ALTER TABLE project_categories DROP CONSTRAINT IF EXISTS project_categories_name_key;
ALTER TABLE project_categories ADD CONSTRAINT project_categories_tenant_id_name_key UNIQUE (tenant_id, name);
