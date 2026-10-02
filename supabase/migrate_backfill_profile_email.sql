-- Ferme à la source le trou documenté dans server/routes/agencySetup.ts
-- (adminRecipients) et dans CLAUDE.md (« Invitation d'un nouveau membre
-- d'équipe ») : handle_new_user() ne copiait que le nom depuis auth.users,
-- jamais l'email. Un compte né d'une connexion Google (qui ne passe par
-- aucune route applicative avant ce trigger) se retrouvait donc avec
-- profiles.email vide, alors que l'adresse existe bien côté Auth — toute
-- recherche de compte existant par `profiles.eq('email', ...)` (POST
-- /api/team, POST /api/admin/platform-admins, ...) le manquait.

-- 1. Le trigger copie désormais l'email à la création. DO UPDATE ... COALESCE
--    (pas DO NOTHING) : une route applicative qui a déjà upserté un profil
--    plus riche avant que ce trigger s'exécute garde ses valeurs ; seul un
--    email resté NULL est complété.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name', NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = COALESCE(profiles.email, EXCLUDED.email);
  RETURN NEW;
END;
$$;

-- 2. Backfill des comptes déjà créés avant ce correctif : ne touche que les
--    lignes dont l'email est encore vide, jamais une valeur déjà présente.
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL AND u.email IS NOT NULL;
