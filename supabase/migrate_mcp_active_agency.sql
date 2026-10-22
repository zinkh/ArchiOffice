-- ============================================================
-- Connecteur MCP : agence active propre à chaque connexion
-- ============================================================
-- Jusqu'ici une liaison MCP était figée sur le cabinet affiché dans
-- l'interface web au moment du consentement (`mcp_connections.tenant_id`) :
-- un architecte qui exerce dans deux structures (AAZS et AACZ) devait
-- supprimer puis recréer la liaison pour changer de cabinet.
--
-- `active_tenant_id` est la sélection faite DEPUIS le connecteur (outil
-- switch_agency). Elle est propre à UNE connexion : elle ne dépend ni du
-- cabinet affiché dans le navigateur, ni des autres connexions de la
-- personne. NULL signifie « jamais changé » : la connexion reste sur le
-- cabinet de consentement (`tenant_id`), ce qui préserve toutes les liaisons
-- existantes sans rien leur demander.
--
-- Rien n'est déplacé : seule la sélection change. L'appartenance au cabinet
-- choisi est revérifiée contre `tenant_memberships` à CHAQUE appel (voir
-- packages/archioffice-agents/src/server/mcp/store.ts) ; cette colonne n'est
-- donc jamais une autorisation, seulement une préférence.
--
-- ON DELETE SET NULL : si le cabinet sélectionné disparaît, la connexion
-- retombe sur son cabinet de consentement au lieu d'être supprimée.
ALTER TABLE mcp_connections
  ADD COLUMN IF NOT EXISTS active_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_tenant_set_at TIMESTAMPTZ;
