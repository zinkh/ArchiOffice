-- ── Apprentissage des agents : mémoire de corrections, détection de
--    compétences manquantes, auto-rédaction de notes — toujours soumis à
--    validation humaine ────────────────────────────────────────────────────
--
-- Un agent qui se trompe ou qui bute sur une capacité qui lui manque n'avait
-- jusqu'ici aucun moyen de le faire remonter autrement qu'en le disant dans
-- sa réponse à l'utilisateur, perdu dans la conversation dès le tour suivant.
-- `agent_learning_suggestions` est une file d'attente : l'agent y dépose une
-- proposition (jamais une écriture définitive), l'architecte l'approuve ou la
-- rejette depuis /agents/learning. Rien ne s'applique tout seul — même
-- principe que `needs_confirmation` sur create_record : une action qui change
-- durablement le comportement d'un agent (sa mémoire, ses capacités) se
-- confirme, elle ne se déduit jamais.
--
-- `learning_enabled` (colonne de plus sur `agents`, off par défaut et jamais
-- héritée d'un template — même traitement que knowledge_enabled/
-- web_search_enabled) donne accès à l'outil suggerer_amelioration :
--
--   - 'correction'         : l'utilisateur a corrigé une réponse ou une
--     hypothèse de l'agent ; approuver dépose la correction comme document
--     dans sa bibliothèque de connaissances (documents.resource_type =
--     'agents', voir migrate_agent_knowledge.sql) — relue au tour suivant.
--   - 'missing_capability' : l'agent a identifié qu'une capacité lui
--     manquait (outil, accès) pour répondre correctement. `suggested_capability`
--     nomme la colonne concernée (ex. 'mail_enabled') pour que l'écran de
--     revue puisse renvoyer directement vers /agents/:id/edit — approuver
--     n'active JAMAIS la capacité toute seule.
--   - 'knowledge_note'     : l'agent propose lui-même une note à verser à sa
--     bibliothèque (ce qu'il a appris en tâche), pas une correction reçue.
--
-- `title/content` restent du texte libre : c'est le modèle qui rédige, un
-- humain qui valide avant que ça ne devienne une donnée durable.
CREATE TABLE IF NOT EXISTS agent_learning_suggestions (
  id                    TEXT PRIMARY KEY,
  tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  agent_id              UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('correction', 'missing_capability', 'knowledge_note')),
  title                 TEXT NOT NULL,
  content               TEXT NOT NULL,
  suggested_capability  TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  conversation_id       UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by           UUID,
  reviewed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_learning_suggestions_tenant ON agent_learning_suggestions(tenant_id, status, created_at DESC);

ALTER TABLE agent_learning_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON agent_learning_suggestions;
CREATE POLICY "tenant_isolation" ON agent_learning_suggestions
  USING (tenant_id = my_tenant_id());

ALTER TABLE agents ADD COLUMN IF NOT EXISTS learning_enabled BOOLEAN NOT NULL DEFAULT FALSE;
