-- ============================================================
-- MIGRATION : Page profil (bio, CV, études, expérience) + Messagerie interne
-- À exécuter dans le SQL Editor Supabase
-- ============================================================

-- ── Profil enrichi ──────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cv_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cv_filename TEXT;

CREATE TABLE IF NOT EXISTS profile_education (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  school TEXT NOT NULL,
  degree TEXT,
  field TEXT,
  start_year TEXT,
  end_year TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_experience (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profile_education_user_idx ON profile_education(user_id);
CREATE INDEX IF NOT EXISTS profile_experience_user_idx ON profile_experience(user_id);

ALTER TABLE profile_education ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_experience ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON profile_education;
CREATE POLICY tenant_isolation ON profile_education USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON profile_experience;
CREATE POLICY tenant_isolation ON profile_experience USING (tenant_id = my_tenant_id());

-- ── Messagerie interne ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  is_group BOOLEAN DEFAULT FALSE,
  name TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id),
  sender_name TEXT,
  content TEXT,
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS conversation_participants_conv_idx ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON conversations(tenant_id, last_message_at DESC);

-- Security-definer helper: bypasses RLS internally to avoid self-referential
-- recursion when conversation_participants checks its own membership.
CREATE OR REPLACE FUNCTION is_conversation_participant(conv_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  )
$$;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS participants_only ON conversations;
CREATE POLICY participants_only ON conversations USING (is_conversation_participant(id));

DROP POLICY IF EXISTS participants_only ON conversation_participants;
CREATE POLICY participants_only ON conversation_participants USING (is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS participants_only ON messages;
CREATE POLICY participants_only ON messages USING (is_conversation_participant(conversation_id));

-- Enable Realtime (Postgres Changes) on messages so the UI gets live updates
-- without polling, scoped by the RLS policy above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;
