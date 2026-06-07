-- ============================================================
-- ArchiOffice — Migration : Système d'Agents IA
-- ============================================================

-- 1. Colonnes agents sur la table tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_token_balance   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_billing_mode    TEXT    NOT NULL DEFAULT 'prepaid'
  CHECK (agent_billing_mode IN ('prepaid', 'pay_per_use'));

-- 2. TABLE AGENTS (profils d'agents IA par tenant)
CREATE TABLE IF NOT EXISTS agents (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID REFERENCES tenants(id) ON DELETE CASCADE,
  slug                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  role_title              TEXT NOT NULL,
  avatar_initials         TEXT NOT NULL DEFAULT 'AI',
  avatar_color            TEXT NOT NULL DEFAULT '#206bc4',
  tone                    TEXT,
  directives              TEXT,
  system_prompt_override  TEXT,
  context_scopes          TEXT[] NOT NULL DEFAULT '{}',
  is_active               BOOLEAN NOT NULL DEFAULT FALSE,
  is_system_template      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

-- 3. TABLE AGENT_CONVERSATIONS
CREATE TABLE IF NOT EXISTS agent_conversations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  agent_id    UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID NOT NULL,
  title       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, user_id)
);

-- 4. TABLE AGENT_MESSAGES
CREATE TABLE IF NOT EXISTS agent_messages (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id  UUID REFERENCES agent_conversations(id) ON DELETE CASCADE NOT NULL,
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABLE AGENT_TOKEN_USAGE (audit log de consommation)
CREATE TABLE IF NOT EXISTS agent_token_usage (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  agent_id         UUID REFERENCES agents(id),
  user_id          UUID,
  conversation_id  UUID,
  tokens_used      INTEGER NOT NULL,
  cost_eur_cents   INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_agents_tenant          ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_conv_user        ON agent_conversations(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_msgs_conv        ON agent_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_token_usage_tenant ON agent_token_usage(tenant_id, created_at);

-- RLS
ALTER TABLE agents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_token_usage     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON agents
  USING (tenant_id = my_tenant_id() OR tenant_id IS NULL);

CREATE POLICY "tenant_isolation" ON agent_conversations
  USING (tenant_id = my_tenant_id());

CREATE POLICY "tenant_isolation" ON agent_messages
  USING (tenant_id = my_tenant_id());

CREATE POLICY "tenant_isolation" ON agent_token_usage
  USING (tenant_id = my_tenant_id());

-- ── Seed : 13 templates système (tenant_id NULL = template global) ─────────
INSERT INTO agents (tenant_id, slug, name, role_title, avatar_initials, avatar_color, tone, directives, context_scopes, is_active, is_system_template)
VALUES
  (NULL, 'secretaire',         'Sophie',    'Secrétaire Administrative',         'SA', '#206bc4',
   'Professionnel, organisé, accueillant',
   'Vérifier toujours la disponibilité de l''architecte avant de confirmer un rendez-vous. Classer les documents par numéro de projet. Ne jamais communiquer d''informations financières confidentielles.',
   ARRAY['meetings','contacts','projects','documents'], TRUE, TRUE),

  (NULL, 'charge-projet',      'Raphaël',   'Chargé de Projet',                  'CP', '#2fb344',
   'Direct, rigoureux, orienté solutions',
   'Toujours rapporter les retards avec impact sur le planning global. Vérifier les jalons avant de donner un état d''avancement. Ne jamais s''engager sur un délai sans vérifier les dépendances.',
   ARRAY['projects','tasks','meetings','contacts'], FALSE, TRUE),

  (NULL, 'pilote-chantier',    'Karim',     'Pilote de Chantier',                'PC', '#f76707',
   'Pragmatique, terrain, direct',
   'Toujours référencer le numéro de projet dans les rapports. Signaler les non-conformités immédiatement. Distinguer clairement OPR et réception définitive.',
   ARRAY['projects','meetings','documents'], FALSE, TRUE),

  (NULL, 'economiste',         'Marc',      'Économiste de la Construction',     'EC', '#ae3ec9',
   'Analytique, précis, factuel',
   'Toujours exprimer les coûts HT sauf mention contraire. Signaler tout dépassement budgétaire > 5%. Ne jamais valider une offre sans comparer avec l''estimation initiale.',
   ARRAY['projects','documents','contacts'], FALSE, TRUE),

  (NULL, 'comptable',          'Yasmine',   'Comptable',                         'CO', '#1098ad',
   'Méticuleux, discret, organisé',
   'Distinguer clairement HT et TTC. Toujours mentionner les délais de paiement légaux. Ne jamais divulguer de données comptables à des tiers non autorisés.',
   ARRAY['projects','contacts'], FALSE, TRUE),

  (NULL, 'juridique',          'Léa',       'Assistante Juridique',              'JU', '#e8590c',
   'Précis, prudent, exhaustif',
   'Toujours mentionner qu''une analyse juridique définitive requiert un avocat. Référencer le code applicable. Signaler les délais légaux impératifs.',
   ARRAY['projects','documents','contacts'], FALSE, TRUE),

  (NULL, 'responsable-hqe',    'Amara',     'Responsable HQE / Développement Durable', 'HQ', '#2fb344',
   'Engagé, pédagogue, précis',
   'Référencer les certifications applicables (HQE, BREEAM, E+C-). Toujours mentionner les indicateurs carbone. Proposer des alternatives bas-carbone.',
   ARRAY['projects','documents','specifications'], FALSE, TRUE),

  (NULL, 'ingenieur-thermique','Guillaume', 'Ingénieur Thermique',               'TH', '#206bc4',
   'Technique, factuel, normatif',
   'Toujours référencer la RT2020/RE2020 applicable. Distinguer calcul réglementaire et calcul de dimensionnement. Préciser les logiciels de calcul utilisés.',
   ARRAY['projects','documents','specifications'], FALSE, TRUE),

  (NULL, 'ingenieur-structure','Nadia',     'Ingénieure Structure',              'ST', '#ae3ec9',
   'Rigoureux, sécuritaire, précis',
   'Toujours mentionner les Eurocodes et normes NF applicables. Distinguer calculs préliminaires et notes de calcul définitives. Signaler toute hypothèse de charge inhabituelle.',
   ARRAY['projects','documents','specifications'], FALSE, TRUE),

  (NULL, 'ingenieur-fluides',  'Claire',    'Ingénieure Fluides',                'FL', '#1098ad',
   'Technique, synthétique, méthodique',
   'Distinguer CVC, plomberie et sprinkler. Référencer les DTU applicables. Mentionner les contraintes acoustiques liées aux installations.',
   ARRAY['projects','documents','specifications'], FALSE, TRUE),

  (NULL, 'acousticien',        'Théo',      'Acousticien',                       'AC', '#f76707',
   'Précis, normatif, pédagogue',
   'Référencer la NRA et les exigences réglementaires selon la nature du bâtiment. Distinguer isolement aérien, impact et bruit d''équipement. Mentionner les classements acoustiques.',
   ARRAY['projects','documents','specifications'], FALSE, TRUE),

  (NULL, 'paysagiste',         'Inès',      'Paysagiste',                        'PA', '#2fb344',
   'Créatif, réglementaire, attentif au contexte',
   'Intégrer les contraintes PLU (pleine terre, coefficient de végétalisation). Référencer les essences locales et adaptées au climat. Signaler les contraintes de gestion des eaux pluviales.',
   ARRAY['projects','documents','contacts'], FALSE, TRUE),

  (NULL, 'urbaniste',          'Adam',      'Urbaniste',                         'UR', '#e8590c',
   'Institutionnel, précis, réglementaire',
   'Toujours vérifier le PLU/PLUi en vigueur. Distinguer CU opérationnel et d''information. Mentionner les délais d''instruction réglementaires.',
   ARRAY['projects','documents','contacts'], FALSE, TRUE)

ON CONFLICT DO NOTHING;
