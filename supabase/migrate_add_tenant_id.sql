-- ============================================================
-- MIGRATION : Ajout tenant_id aux tables existantes
-- Préserve toutes les données existantes
-- À exécuter dans le SQL Editor Supabase
-- ============================================================

-- ÉTAPE 1 : Créer la table tenants si elle n'existe pas
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ÉTAPE 2 : Créer un tenant "par défaut" pour les données existantes
-- ============================================================
INSERT INTO tenants (id, slug, name, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Cabinet par défaut', 'trial')
ON CONFLICT (id) DO NOTHING;

-- ÉTAPE 3 : Créer/mettre à jour la table profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  name        TEXT,
  role        TEXT DEFAULT 'user',
  system_role TEXT DEFAULT 'user',
  avatar      TEXT,
  sender_option TEXT,
  default_email_template TEXT,
  phone       TEXT,
  job_title   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Ajouter tenant_id à profiles si la table existait déjà sans
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS system_role TEXT DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sender_option TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_email_template TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Assigner le tenant par défaut aux profils existants sans tenant
UPDATE profiles SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

-- Trigger inscription automatique
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ÉTAPE 4 : Ajouter tenant_id à chaque table métier
-- Pattern : ADD COLUMN IF NOT EXISTS (nullable) → UPDATE → NOT NULL
-- ============================================================

-- contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE contacts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE contacts ALTER COLUMN tenant_id SET NOT NULL;

-- contact_categories
ALTER TABLE contact_categories ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE contact_categories SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE contact_categories ALTER COLUMN tenant_id SET NOT NULL;

-- project_categories
ALTER TABLE project_categories ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE project_categories SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE project_categories ALTER COLUMN tenant_id SET NOT NULL;

-- projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE projects SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL;

-- team_members
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE team_members SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE team_members ALTER COLUMN tenant_id SET NOT NULL;

-- tenders
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE tenders SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE tenders ALTER COLUMN tenant_id SET NOT NULL;

-- tender_specialties
ALTER TABLE tender_specialties ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE tender_specialties SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE tender_specialties ALTER COLUMN tenant_id SET NOT NULL;

-- proposals
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE proposals SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE proposals ALTER COLUMN tenant_id SET NOT NULL;

-- proposal_specialties
ALTER TABLE proposal_specialties ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE proposal_specialties SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE proposal_specialties ALTER COLUMN tenant_id SET NOT NULL;

-- milestones
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE milestones SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE milestones ALTER COLUMN tenant_id SET NOT NULL;

-- invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE invoices SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE invoices ALTER COLUMN tenant_id SET NOT NULL;

-- invoice_items
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE invoice_items SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE invoice_items ALTER COLUMN tenant_id SET NOT NULL;

-- project_cotraitants
ALTER TABLE project_cotraitants ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE project_cotraitants SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE project_cotraitants ALTER COLUMN tenant_id SET NOT NULL;

-- project_stakeholders
ALTER TABLE project_stakeholders ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE project_stakeholders SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE project_stakeholders ALTER COLUMN tenant_id SET NOT NULL;

-- project_lots
ALTER TABLE project_lots ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE project_lots SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE project_lots ALTER COLUMN tenant_id SET NOT NULL;

-- tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE tasks SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE tasks ALTER COLUMN tenant_id SET NOT NULL;

-- specifications
ALTER TABLE specifications ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE specifications SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE specifications ALTER COLUMN tenant_id SET NOT NULL;

-- ordres_de_service
ALTER TABLE ordres_de_service ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE ordres_de_service SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE ordres_de_service ALTER COLUMN tenant_id SET NOT NULL;

-- site_reports
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE site_reports SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE site_reports ALTER COLUMN tenant_id SET NOT NULL;

-- site_report_notes
ALTER TABLE site_report_notes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE site_report_notes SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE site_report_notes ALTER COLUMN tenant_id SET NOT NULL;

-- documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE documents SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE documents ALTER COLUMN tenant_id SET NOT NULL;

-- document_versions
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE document_versions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE document_versions ALTER COLUMN tenant_id SET NOT NULL;

-- visas
ALTER TABLE visas ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE visas SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE visas ALTER COLUMN tenant_id SET NOT NULL;

-- receptions
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE receptions SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE receptions ALTER COLUMN tenant_id SET NOT NULL;

-- plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE plans SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE plans ALTER COLUMN tenant_id SET NOT NULL;

-- reserves
ALTER TABLE reserves ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE reserves SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE reserves ALTER COLUMN tenant_id SET NOT NULL;

-- dpgf_items
ALTER TABLE dpgf_items ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE dpgf_items SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE dpgf_items ALTER COLUMN tenant_id SET NOT NULL;

-- situations
ALTER TABLE situations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE situations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE situations ALTER COLUMN tenant_id SET NOT NULL;

-- detail_situations
ALTER TABLE detail_situations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE detail_situations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE detail_situations ALTER COLUMN tenant_id SET NOT NULL;

-- cctps
ALTER TABLE cctps ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE cctps SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE cctps ALTER COLUMN tenant_id SET NOT NULL;

-- dpgfs
ALTER TABLE dpgfs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE dpgfs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE dpgfs ALTER COLUMN tenant_id SET NOT NULL;

-- settings (UNIQUE sur tenant_id)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE settings SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE settings ALTER COLUMN tenant_id SET NOT NULL;
DO $$ BEGIN
  BEGIN
    ALTER TABLE settings ADD CONSTRAINT settings_tenant_id_key UNIQUE (tenant_id);
  EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
  END;
END $$;

-- lignes_ouvrages (nouvelle table, CREATE IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS lignes_ouvrages (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  lot_id TEXT, designation TEXT, unite TEXT,
  quantite NUMERIC, prix_unitaire NUMERIC, article_id TEXT
);
ALTER TABLE lignes_ouvrages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE lignes_ouvrages SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- articles_type (nouvelle table, CREATE IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS articles_type (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  designation TEXT, unite TEXT, prix_unitaire NUMERIC, categorie TEXT
);
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE articles_type SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- project_categories_junction (pas de tenant_id direct, jointure)
CREATE TABLE IF NOT EXISTS project_categories_junction (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES project_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)
);

-- project_team (pas de tenant_id direct, jointure)
CREATE TABLE IF NOT EXISTS project_team (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, member_id)
);

-- ============================================================
-- ÉTAPE 5 : Lier votre compte utilisateur au tenant par défaut
-- Remplacez 'VOTRE_EMAIL@exemple.com' par votre email Supabase
-- ============================================================
UPDATE profiles
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  OR id IN (
    SELECT p.id FROM profiles p
    JOIN auth.users u ON p.id = u.id
    -- WHERE u.email = 'VOTRE_EMAIL@exemple.com'  -- décommentez pour cibler votre compte
  );

-- ============================================================
-- ÉTAPE 6 : RLS
-- ============================================================

-- Helper function
CREATE OR REPLACE FUNCTION my_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
$$;

-- Activer RLS
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_categories_junction ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_team         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_specialties   ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_cotraitants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_stakeholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_lots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE specifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordres_de_service    ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_report_notes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE visas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE receptions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans                ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserves             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpgf_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE situations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE detail_situations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cctps                ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpgfs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lignes_ouvrages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles_type        ENABLE ROW LEVEL SECURITY;

-- Policies (DROP IF EXISTS pour idempotence)
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'contacts','contact_categories','project_categories','projects',
    'team_members','tenders','tender_specialties','proposals',
    'proposal_specialties','milestones','invoices','invoice_items',
    'project_cotraitants','project_stakeholders','project_lots','tasks',
    'specifications','ordres_de_service','site_reports','site_report_notes',
    'documents','document_versions','visas','receptions','plans','reserves',
    'dpgf_items','situations','detail_situations','cctps','dpgfs','settings',
    'lignes_ouvrages','articles_type'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = my_tenant_id())', t
    );
  END LOOP;
END $$;

-- Jonctions
DROP POLICY IF EXISTS tenant_isolation ON project_categories_junction;
CREATE POLICY tenant_isolation ON project_categories_junction
  USING (project_id IN (SELECT id FROM projects WHERE tenant_id = my_tenant_id()));

DROP POLICY IF EXISTS tenant_isolation ON project_team;
CREATE POLICY tenant_isolation ON project_team
  USING (project_id IN (SELECT id FROM projects WHERE tenant_id = my_tenant_id()));

-- Profiles
DROP POLICY IF EXISTS own_profile ON profiles;
CREATE POLICY own_profile ON profiles
  USING (id = auth.uid() OR tenant_id = my_tenant_id());

-- Tenants
DROP POLICY IF EXISTS own_tenant ON tenants;
CREATE POLICY own_tenant ON tenants
  USING (id = my_tenant_id());

-- ============================================================
-- VÉRIFICATION FINALE
-- ============================================================
SELECT 'Migration terminée !' AS status,
       (SELECT COUNT(*) FROM tenants) AS nb_tenants,
       (SELECT COUNT(*) FROM profiles WHERE tenant_id IS NOT NULL) AS profiles_avec_tenant;
