-- ============================================================
-- ArchiOffice — Migration : domaine du courrier entrant par cabinet
-- ============================================================
-- Le domaine de l'alias « agents+<slug>@<domaine> » n'est plus une variable
-- d'environnement unique : chaque cabinet saisit le sien depuis
-- /settings > Agents IA > Courrier entrant. NULL = repli sur
-- AGENT_MAIL_INBOX_ALIAS_DOMAIN (instance), puis carte sans alias.
-- Validé et normalisé par server/routes/settings.ts (normalizeMailInboxDomain).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mail_inbox_domain TEXT;
