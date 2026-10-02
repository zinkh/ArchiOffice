-- ============================================================
-- ArchiOffice — Migration : bot Telegram (voix en voiture)
-- ============================================================
-- Alternative au lien MCP/Gemini (payant, hors conduite) et à App Actions
-- Android (comportement non garanti en Android Auto) : la messagerie est une
-- catégorie pleinement supportée par Android Auto (dictée vocale en entrée,
-- lecture à voix haute des réponses en sortie), donc un bot Telegram permet
-- une vraie conversation avec un agent ArchiOffice en conduisant, sans
-- dépendre d'un abonnement ni d'un comportement Google non documenté.
--
-- Deux tables :
--   - telegram_link_codes  : code à usage unique, généré depuis /settings,
--     que l'architecte envoie en message privé au bot (`/start <code>`) pour
--     rattacher SON compte Telegram à SON compte ArchiOffice. Très court
--     (quelques minutes), comme les codes d'autorisation OAuth du lien MCP.
--   - telegram_connections : la liaison durable une fois le code consommé.
--     Contrairement au lien MCP — où c'est GEMINI qui garde le jeton et le
--     représente à chaque appel, ArchiOffice ne validant qu'un haché — ici
--     c'est ArchiOffice ELLE-MÊME qui doit re-présenter ce jeton à son propre
--     webhook à chaque message Telegram entrant. D'où deux colonnes portant
--     la même valeur sous deux formes : `access_token_hash` (unique, vérifié
--     par le repli du middleware /api exactement comme un jeton MCP) et
--     `access_token_encrypted` (chiffrement réversible, server/secretsCrypto.ts
--     — la même bibliothèque que les jetons OAuth Gmail/Calendar/Zoho), pour
--     que le webhook puisse retrouver le jeton en clair à présenter en sortie.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL,
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chat_id                 BIGINT NOT NULL UNIQUE,
  access_token_hash       TEXT NOT NULL UNIQUE,
  access_token_encrypted  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires ON telegram_link_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_connections_user ON telegram_connections(tenant_id, user_id);

-- Accès service role uniquement, comme mcp_connections/email_connections.
ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_connections ENABLE ROW LEVEL SECURITY;
