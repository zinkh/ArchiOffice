-- ============================================================
-- ArchiOffice — Migration : serveur MCP pour Gemini Spark
-- ============================================================
-- Permet à un architecte de connecter son cabinet ArchiOffice comme
-- « custom app » MCP dans Gemini (Connected Apps → Custom apps for Spark),
-- pour poser à Gemini Spark des questions/tâches de fond sur ses données
-- (planning, tâches, factures) sans passer par un programme partenaire
-- Google — voir la doc du plan pour le détail des surfaces Gemini
-- concernées (Spark, pas l'assistant vocal d'Android Auto).
--
-- Trois tables, le strict nécessaire pour un serveur d'autorisation OAuth
-- 2.1 minimal (authorization code + PKCE + refresh token), Gemini jouant le
-- rôle de client dynamique (RFC 7591, un seul enregistrement en pratique
-- puisque c'est toujours le même logiciel client qui se connecte) :
--
--   - mcp_oauth_clients  : le client OAuth (Gemini), enregistré dynamiquement
--     à la première connexion. `client_secret_hash` est vide pour un client
--     "public" (PKCE fait tout le travail de preuve, c'est le cas standard
--     pour un client qui ne peut pas garder un secret confidentiel côté
--     Google) — jamais le secret en clair.
--   - mcp_oauth_grants   : le code d'autorisation à usage unique, très
--     court (quelques minutes), émis après l'écran de consentement côté
--     ArchiOffice (SPA, authentifiée par la session existante de
--     l'architecte) et échangé une seule fois contre un jeton.
--   - mcp_connections    : la liaison durable une fois l'échange fait —
--     jeton d'accès et de rafraîchissement, tous deux stockés SOUS FORME DE
--     HACHÉ (SHA-256) et jamais en clair, sur le même principe que les mots
--     de passe : le serveur n'a besoin que de vérifier une correspondance,
--     jamais de relire le jeton. Revocable depuis /settings
--     (`revoked_at`), un jeton révoqué n'authentifie plus rien même si
--     Gemini continue de le présenter.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id          TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name        TEXT,
  redirect_uris      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL,
  redirect_uri          TEXT NOT NULL,
  code_hash             TEXT NOT NULL UNIQUE,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scope                 TEXT NOT NULL DEFAULT '',
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL,
  access_token_hash   TEXT NOT NULL UNIQUE,
  access_expires_at   TIMESTAMPTZ NOT NULL,
  refresh_token_hash  TEXT UNIQUE,
  scope               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_expires ON mcp_oauth_grants(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_user ON mcp_connections(tenant_id, user_id);

-- Accès service role uniquement — ces tables ne sont jamais lues/écrites via
-- PostgREST direct depuis le frontend, seulement par server.ts (clé service
-- role, qui contourne RLS), exactement comme les autres tables d'infra
-- d'intégration (email_connections, calendar_connections).
ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_connections   ENABLE ROW LEVEL SECURITY;
