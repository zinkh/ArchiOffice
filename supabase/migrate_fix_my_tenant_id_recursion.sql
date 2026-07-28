-- ============================================================
-- MIGRATION : Corrige la récursion infinie de my_tenant_id()
-- ============================================================
--
-- my_tenant_id() interroge `profiles`, qui est elle-même protégée par
-- la policy RLS "own_profile" :
--   id = auth.uid() OR tenant_id = my_tenant_id()
--
-- Sans SECURITY DEFINER, la fonction s'exécute avec les droits de
-- l'appelant : sa requête interne sur `profiles` redéclenche donc la
-- même policy, qui rappelle my_tenant_id(), etc. — récursion infinie
-- jusqu'à "54001 stack depth limit exceeded" côté Postgres.
--
-- Ce bug était latent depuis la création du schéma (le backend passe
-- presque toujours par supabaseAdmin, en clé service_role, qui
-- contourne RLS). Le flux de "cloud-link" du client Windows
-- (server/cloudLinkRoutes.ts) est le premier chemin à interroger
-- `profiles` avec le vrai JWT utilisateur (clé anon), donc soumis à
-- RLS — et le premier à déclencher cette récursion.
--
-- SECURITY DEFINER fait tourner la lecture interne avec les droits du
-- propriétaire de la fonction (donc hors RLS pour cette lecture),
-- tandis que auth.uid() continue de refléter le JWT de l'appelant : la
-- fonction ne renvoie toujours que le tenant_id de l'appelant lui-même,
-- aucune isolation multi-tenant n'est affaiblie.
-- ============================================================

CREATE OR REPLACE FUNCTION my_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
$$;
