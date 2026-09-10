-- ============================================================
-- Multi-cabinets : un même architecte, plusieurs agences
-- ============================================================
-- `profiles` porte un unique `tenant_id`, et sa clé primaire est l'id du
-- compte auth : un architecte qui exerce dans deux cabinets (le sien et une
-- structure associée, une SCPA, un groupement) ne pouvait donc appartenir
-- qu'à un seul des deux, et devait se créer un second compte avec une autre
-- adresse mail — deux identités, deux mots de passe, deux boîtes mail
-- connectées, pour une seule personne.
--
-- `tenant_memberships` sépare l'identité (qui reste dans `profiles`, une
-- ligne par personne) de l'appartenance (une ligne par couple
-- personne × cabinet, avec le rôle tenu DANS ce cabinet — on est souvent
-- gérant de son agence et simple collaborateur dans l'autre).
--
-- `profiles.tenant_id` n'est pas supprimé : il reste le cabinet par défaut,
-- celui sur lequel une session s'ouvre, et le repli pour toute instance qui
-- n'aurait pas encore joué cette migration. C'est `is_default` qui le double
-- ici ; les deux sont tenus synchrones par server/tenantMemberships.ts.
CREATE TABLE IF NOT EXISTS tenant_memberships (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Rôle métier libre (« Architecte associé », « Chef de projet »...) et rôle
  -- système fermé (admin / manager / pm / user) : les mêmes deux notions que
  -- sur `profiles`, mais tenues par cabinet.
  role        TEXT DEFAULT 'Member',
  system_role TEXT DEFAULT 'user',
  -- Le supérieur hiérarchique n'est pas la même personne d'un cabinet à
  -- l'autre — d'où une colonne ici plutôt que le seul profiles.manager_id.
  manager_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, tenant_id)
);

-- Au plus un cabinet par défaut par personne, sans en imposer un : index
-- unique PARTIEL, comme document_templates et email_connections
-- (migrate_multi_mail_calendar.sql) le font déjà pour la même raison.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_memberships_default
  ON tenant_memberships(user_id) WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user   ON tenant_memberships(user_id);

-- Reprise de l'existant : chaque profil déjà rattaché devient une adhésion
-- par défaut, avec le rôle qu'il portait. Idempotent (ON CONFLICT), donc
-- rejouable sur une instance déjà migrée.
INSERT INTO tenant_memberships (user_id, tenant_id, role, system_role, manager_id, is_default)
SELECT p.id, p.tenant_id, COALESCE(p.role, 'Member'), COALESCE(p.system_role, 'user'), p.manager_id, TRUE
FROM profiles p
WHERE p.tenant_id IS NOT NULL
ON CONFLICT (user_id, tenant_id) DO NOTHING;

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;

-- Chacun voit ses propres adhésions, et celles des personnes du cabinet où il
-- se trouve (c'est ce que la page Équipe affiche déjà).
DROP POLICY IF EXISTS "own_memberships" ON tenant_memberships;
CREATE POLICY "own_memberships" ON tenant_memberships
  USING (user_id = auth.uid() OR tenant_id = my_tenant_id());

-- Le cabinet par défaut d'une personne, en tenant compte des adhésions : un
-- compte dont le profil n'a plus de tenant_id (cas d'un rattachement fait
-- uniquement côté adhésions) reste ainsi visible pour les policies RLS.
CREATE OR REPLACE FUNCTION my_tenant_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM profiles WHERE id = auth.uid()),
    (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() AND is_default LIMIT 1),
    (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1)
  )
$$;

-- L'ENSEMBLE des cabinets d'une personne. Les policies "tenant_isolation"
-- gardent volontairement `my_tenant_id()` : le client ne requête aucune table
-- directement (tout passe par l'API, qui tranche le cabinet actif par requête
-- — voir server/tenantContext.ts), et une policy en `IN (...)` rendrait au
-- contraire visibles, dans une même vue, les lignes des deux cabinets. Cette
-- fonction est là pour les vérifications qui portent bien sur l'appartenance
-- (« ai-je le droit de basculer sur ce cabinet ? »), pas sur les données.
CREATE OR REPLACE FUNCTION my_tenant_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()
  UNION
  SELECT tenant_id FROM profiles WHERE id = auth.uid() AND tenant_id IS NOT NULL
$$;
