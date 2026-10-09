-- ============================================================
-- MIGRATION : durcissement suite aux avertissements du linter Supabase
-- ============================================================
--
-- 1. rls_policy_always_true : une politique « Authenticated full access »
--    (USING true / WITH CHECK true) était posée sur 30 tables en plus de
--    `tenant_isolation`. Les politiques permissives s'additionnent en OU :
--    la seconde annulait la première, et toute personne connectée pouvait
--    lire et écrire les données de TOUS les cabinets avec la clé anon.
--    Le backend passe par la clé service role (hors RLS) et le frontend
--    n'interroge aucune table directement : seule `tenant_isolation` reste.
--
-- 2. function_search_path_mutable : search_path figé sur les fonctions.
--
-- 3. *_security_definer_function_executable : EXECUTE retiré là où l'API
--    REST n'a aucune raison d'appeler la fonction (hors fonctions de
--    déclencheur, voir plus bas). my_tenant_id(),
--    my_tenant_ids() et is_conversation_participant() servent dans des
--    politiques RLS évaluées avec les droits de l'appelant : `authenticated`
--    les garde, seul `anon` les perd.
--
-- 4. public_bucket_allows_listing : la lecture d'un objet d'un bucket
--    public passe par son URL, sans politique SELECT. Celle-ci ne servait
--    qu'à permettre de LISTER tout le bucket `uploads`.
--
-- Rejouable. Non traité ici : « Leaked Password Protection » est un
-- réglage du tableau de bord (Authentication > Providers > Email).
-- ============================================================

-- 1. Politiques permissives -----------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cctps', 'contact_categories', 'contacts', 'detail_situations',
    'document_versions', 'documents', 'dpgf_items', 'dpgfs', 'invoice_items',
    'invoices', 'milestones', 'ordres_de_service', 'plans',
    'project_categories', 'project_categories_junction', 'project_cotraitants',
    'project_lots', 'project_stakeholders', 'project_team', 'projects',
    'proposal_specialties', 'proposals', 'receptions', 'reserves', 'settings',
    'site_report_notes', 'site_reports', 'situations', 'tasks', 'team_members',
    'tender_specialties', 'tenders', 'visas'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated full access" ON public.%I', t);
  END LOOP;
END $$;

-- 2. search_path ----------------------------------------------------------
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.is_conversation_participant(text) SET search_path = public;
ALTER FUNCTION public.increment_ai_credits(uuid, integer) SET search_path = public;
ALTER FUNCTION public.deduct_ai_credits(uuid, integer) SET search_path = public;
ALTER FUNCTION public.reserve_ai_credit(uuid, integer) SET search_path = public;
ALTER FUNCTION public.settle_ai_credit(uuid, integer) SET search_path = public;
ALTER FUNCTION public.refresh_monthly_ai_credits(uuid, integer) SET search_path = public;

-- 3. EXECUTE --------------------------------------------------------------
-- handle_new_user() et log_sync_change() (fonctions de déclencheur) gardent
-- leur EXECUTE : un REVOKE sur log_sync_change a déjà été tenté puis annulé
-- (migrations revoke_log_sync_change_rpc_execute / restore_...) car il
-- cassait des écritures. À ne pas refaire sans test sur une base de recette.

-- Facturation IA : appelée uniquement par le backend (service role).
REVOKE EXECUTE ON FUNCTION public.increment_ai_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_ai_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_credit(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_ai_credit(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_monthly_ai_credits(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Aides RLS : utilisées par les politiques, donc `authenticated` conserve.
REVOKE EXECUTE ON FUNCTION public.my_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_tenant_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_tenant_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(text) TO authenticated, service_role;

-- 4. Bucket public --------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read uploads" ON storage.objects;
