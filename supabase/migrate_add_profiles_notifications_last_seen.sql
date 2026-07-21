-- "Marquer tout comme lu" (page Notifications) écrivait notifications_last_seen
-- sur team_members, filtré par auth_user_id + tenant_id. team_members est un
-- roster séparé et n'a pas forcément de ligne pour chaque utilisateur
-- authentifié (ex. le propriétaire de l'agence n'y figure pas toujours) :
-- l'UPDATE ne touchait alors aucune ligne, silencieusement, et le prochain
-- rafraîchissement du fil (toutes les 30s) recalculait "non lu" à partir
-- d'une valeur jamais mise à jour. profiles, elle, a garantiment une ligne
-- par utilisateur authentifié (clé primaire = auth.users.id), donc on y
-- déplace ce suivi.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notifications_last_seen TIMESTAMPTZ;
