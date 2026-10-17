-- Une boîte mail (et un calendrier) par défaut par personne ET PAR CABINET.
--
-- migrate_multi_mail_calendar.sql posait l'unicité du défaut sur user_id seul,
-- antérieure à tenant_memberships : une personne qui exerce dans deux cabinets
-- ne pouvait avoir qu'un seul défaut pour les deux. Or tout le code lit et pose
-- le défaut dans le cabinet ACTIF (resolveMailAccount, isFirstMailAccountForUser,
-- setDefaultMailAccount, resolveWriteCalendar, tous tenant-scopés) : la première
-- boîte connectée dans le second cabinet y était marquée par défaut et la base
-- refusait l'insertion (23505 sur email_connections_one_default_per_user_idx),
-- d'où une connexion Gmail autorisée par Google mais jamais enregistrée.
--
-- Le nouvel index est créé avant la suppression de l'ancien : l'ancien étant plus
-- strict, aucune ligne existante ne peut le violer.

CREATE UNIQUE INDEX IF NOT EXISTS email_connections_one_default_per_tenant_user_idx
  ON email_connections(tenant_id, user_id) WHERE is_default = true;
DROP INDEX IF EXISTS email_connections_one_default_per_user_idx;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_calendars_one_default_per_tenant_user_idx
  ON calendar_calendars(tenant_id, user_id) WHERE is_default = true;
DROP INDEX IF EXISTS calendar_calendars_one_default_per_user_idx;
