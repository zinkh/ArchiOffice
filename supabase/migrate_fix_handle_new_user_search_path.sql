-- « Database error saving new user » à l'invitation d'un membre.
--
-- GoTrue (Supabase Auth) insère dans auth.users avec le rôle supabase_auth_admin,
-- dont le search_path ne contient pas `public`. Le trigger handle_new_user()
-- écrivait `INSERT INTO profiles` sans schéma : la relation n'était pas
-- résolue et toute la création du compte échouait. On qualifie la table, on
-- fixe le search_path de la fonction, et on ne laisse plus jamais une
-- anomalie de profil bloquer la création du compte (la route applicative
-- fait de toute façon un upsert du profil juste après).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name', NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = COALESCE(public.profiles.email, EXCLUDED.email);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
