-- ============================================================
-- ArchiOffice — Migration : transfert d'un email vers un agent
-- (boîte de messagerie entrante partagée)
-- ============================================================
-- Aucun mécanisme de réception de mail n'existait jusqu'ici dans
-- ArchiOffice : le SMTP configuré (settings.smtp_*) est strictement
-- sortant, et les connecteurs Gmail/Outlook/IMAP existants ne font que du
-- pull à la demande sur la boîte d'UN utilisateur humain. Cette migration
-- pose les trois pièces nécessaires à un relevé périodique d'une boîte
-- IMAP partagée (server/agentMailInbox.ts), sans toucher à
-- email_connections (qui reste strictement personnelle).

-- 1. L'agent de triage : un choix par cabinet, pas par agent (voir
-- CLAUDE.md, « Courrier entrant »). Sur le modèle des autres colonnes de
-- settings.tenant_id (déjà UNIQUE), pas de contrainte d'appartenance en
-- base — server/routes/settings.ts la vérifie à l'écriture via
-- assertTenantEntity, comme le reste des références inter-ressources de
-- cette table.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mail_triage_agent_id UUID REFERENCES agents(id);

-- 2. Pont d'authentification interne sans jeton humain vivant, jetable et
-- à usage unique — même principe que les jetons mcp_at_/tg_at_ déjà
-- dispatchés dans le middleware /api de server.ts, mais avec une durée de
-- vie de quelques minutes au lieu d'une liaison persistante : le poller
-- n'en émet un qu'au moment de rappeler /api/agents/:id/chat, jamais
-- stocké en clair.
CREATE TABLE IF NOT EXISTS agent_mail_relay_tokens (
  token_hash TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_mail_relay_tokens_expires ON agent_mail_relay_tokens(expires_at);

-- 3. Idempotence du relevé : le Message-ID (RFC 5322, unique par message)
-- protège contre un double traitement si le flag \Seen ne tient pas ou si
-- deux relevés se chevauchent — même prudence que
-- article_prix_observations.source_ref pour la remontée de prix BPU.
CREATE TABLE IF NOT EXISTS agent_mail_inbox_processed (
  message_id_header TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
