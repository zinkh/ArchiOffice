-- ============================================================
-- ArchiOffice SaaS — Schema Supabase PostgreSQL
-- À exécuter dans le SQL Editor du dashboard Supabase
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. TENANTS (cabinets d'architecture)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stancer_customer_id TEXT,
  stancer_subscription_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Billing events (payment history)
CREATE TABLE IF NOT EXISTS billing_events (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  event_type         TEXT NOT NULL,
  stancer_payment_id TEXT,
  plan_id            TEXT,
  amount             INTEGER,
  status             TEXT DEFAULT 'pending',
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. PROFILES (utilisateurs liés à auth.users)
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
  address     TEXT,
  job_title   TEXT,
  department  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Créer automatiquement un profil à l'inscription
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

-- Demandes de rattachement à une agence existante (nouveau compte sans tenant
-- qui choisit "Rejoindre une agence existante" — validé par un admin du tenant)
CREATE TABLE IF NOT EXISTS join_requests (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_pending_user_idx
  ON join_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS join_requests_tenant_idx ON join_requests(tenant_id);

-- ============================================================
-- 3. TABLES MÉTIER (toutes avec tenant_id)
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  prefix TEXT, first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
  suffix TEXT, nickname TEXT, company_name TEXT, job_title TEXT, department TEXT,
  email_work TEXT, email_home TEXT, email_other TEXT, email TEXT,
  phone_mobile TEXT, phone_work TEXT, phone_home TEXT, phone_main TEXT,
  phone_fax_work TEXT, phone_fax_home TEXT, phone_pager TEXT, phone_other TEXT, phone TEXT,
  address_work_street TEXT, address_work_city TEXT, address_work_state TEXT,
  address_work_zip TEXT, address_work_country TEXT,
  address_home_street TEXT, address_home_city TEXT, address_home_state TEXT,
  address_home_zip TEXT, address_home_country TEXT,
  address TEXT, zip TEXT, city TEXT, state TEXT, country TEXT,
  candidatures TEXT, affaires TEXT, logo TEXT, ca_amount NUMERIC,
  electronic_signature TEXT, contact_references TEXT, tags TEXT,
  category TEXT, notes TEXT, birthday TEXT, website TEXT,
  created_at TEXT, created_by TEXT, siret TEXT, vat_number TEXT,
  market_number TEXT, market_amount_base NUMERIC,
  market_amount_options NUMERIC, market_amount_avenants NUMERIC
);

CREATE TABLE IF NOT EXISTS contact_categories (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS project_categories (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL, client TEXT NOT NULL, client_id TEXT,
  status TEXT NOT NULL, budget NUMERIC, category TEXT,
  start_date TEXT, end_date TEXT, description TEXT, image_url TEXT,
  project_code TEXT, address TEXT, client_siret TEXT, client_vat_number TEXT,
  client_email TEXT, is_public_client INTEGER DEFAULT 0,
  reference TEXT, projet_detail TEXT, is_entreprise INTEGER DEFAULT 0,
  nom_societe TEXT, rcs TEXT, representant TEXT, qualite TEXT,
  adresse_client TEXT, cp_client TEXT, ville_client TEXT,
  telephone TEXT, portable TEXT, email_client TEXT,
  adresse_terrain TEXT, cp_ville_terrain TEXT, ban_id_terrain TEXT,
  city_code_terrain TEXT, ref_cadastrale TEXT, zone_plu TEXT, surface_parcelle TEXT,
  nom_etablissement TEXT, avant_trav TEXT, apres_trav TEXT, type_et_cat TEXT,
  type_projet TEXT, categorie_projet TEXT, surface_plancher TEXT,
  surface_plancher_ext TEXT, surface_erp TEXT, surface_ert TEXT,
  effectif_public TEXT, effectif_personnel TEXT, ind TEXT, date_modification TEXT,
  is_complete_mission TEXT, is_chantier TEXT, etudes_notes TEXT, chantier_notes TEXT,
  surface TEXT, construction_cost TEXT, remuneration TEXT, progression TEXT,
  project_manager TEXT, cotraitants TEXT, external_intervenants TEXT, entreprises TEXT
);

CREATE TABLE IF NOT EXISTS project_categories_junction (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES project_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL, email TEXT,
  avatar TEXT, system_role TEXT DEFAULT 'user',
  sender_option TEXT, default_email_template TEXT
);

CREATE TABLE IF NOT EXISTS project_team (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, member_id)
);

CREATE TABLE IF NOT EXISTS tenders (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL, client TEXT NOT NULL,
  submission_deadline TEXT NOT NULL, status TEXT NOT NULL,
  value NUMERIC, notes TEXT, mandataire_id TEXT, type TEXT,
  surface NUMERIC, construction_cost NUMERIC, honoraires_percent NUMERIC,
  mandatory_visit INTEGER DEFAULT 0, visit_date TEXT,
  withdrawal_deadline TEXT, archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tender_specialties (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  tender_id TEXT REFERENCES tenders(id) ON DELETE CASCADE,
  specialty_name TEXT NOT NULL, contact_id TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL, client_id TEXT, amount NUMERIC, status TEXT NOT NULL,
  description TEXT, created_at TEXT, reference TEXT, projet_detail TEXT,
  is_entreprise INTEGER DEFAULT 0, nom_societe TEXT, rcs TEXT,
  representant TEXT, qualite TEXT, adresse_client TEXT, cp_client TEXT,
  ville_client TEXT, telephone TEXT, portable TEXT, email_client TEXT,
  adresse_terrain TEXT, cp_ville_terrain TEXT, ref_cadastrale TEXT,
  zone_plu TEXT, surface_parcelle TEXT, nom_etablissement TEXT,
  avant_trav TEXT, apres_trav TEXT, type_et_cat TEXT, type_projet TEXT,
  categorie_projet TEXT, surface_plancher TEXT, surface_plancher_ext TEXT,
  surface_erp TEXT, surface_ert TEXT, effectif_public TEXT,
  effectif_personnel TEXT, ind TEXT, date_modification TEXT,
  project_code TEXT, project_number TEXT, project_status TEXT,
  keywords TEXT, notes TEXT, site_name TEXT, site_description TEXT,
  site_id TEXT, site_address_1 TEXT, site_address_2 TEXT, site_address_3 TEXT,
  site_postbox TEXT, site_city TEXT, site_state TEXT, site_postcode TEXT,
  site_country TEXT, site_gross_perimeter TEXT, site_gross_area TEXT,
  building_name TEXT, building_description TEXT, building_id TEXT,
  contact_fullname TEXT, contact_prefixtitle TEXT, contact_givenname TEXT,
  contact_middlename TEXT, contact_familyname TEXT, contact_suffixtitle TEXT,
  contact_nameorder TEXT, contact_id TEXT, contact_role TEXT,
  contact_department TEXT, contact_company TEXT, contact_companycode TEXT,
  contact_fulladdress TEXT, contact_address_1 TEXT, contact_address_2 TEXT,
  contact_address_3 TEXT, contact_postbox TEXT, contact_city TEXT,
  contact_state TEXT, contact_postcode TEXT, contact_country TEXT,
  contact_email TEXT, contact_phone TEXT, contact_fax TEXT, contact_web TEXT,
  cad_technician_fullname TEXT, cad_technician_prefixtitle TEXT,
  cad_technician_givenname TEXT, cad_technician_middlename TEXT,
  cad_technician_familyname TEXT, cad_technician_suffixtitle TEXT,
  cad_technician_nameorder TEXT, client_fullname TEXT, client_prefixtitle TEXT,
  client_givenname TEXT, client_middlename TEXT, client_familyname TEXT,
  client_suffixtitle TEXT, client_nameorder TEXT, client_company TEXT,
  client_fulladdress TEXT, client_address_1 TEXT, client_address_2 TEXT,
  client_address_3 TEXT, client_postbox TEXT, client_city TEXT,
  client_state TEXT, client_postcode TEXT, client_country TEXT,
  client_email TEXT, client_phone TEXT, client_fax TEXT,
  ed_report_header TEXT, custom_building TEXT, custom_architect TEXT,
  custom_client TEXT, fee_distribution TEXT, construction_cost_num NUMERIC,
  construction_cost NUMERIC DEFAULT 0, ratio_rehab NUMERIC DEFAULT 0, ratio_extension NUMERIC DEFAULT 0,
  complexity_rate NUMERIC, base_fee_percent NUMERIC, exe_fee_percent NUMERIC,
  comp_fee_percent NUMERIC, vat_rate NUMERIC, decimal_precision INTEGER
);

CREATE TABLE IF NOT EXISTS proposal_specialties (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE CASCADE,
  specialty_name TEXT NOT NULL, contact_id TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, proposal_id TEXT, tender_id TEXT,
  title TEXT NOT NULL, due_date TEXT NOT NULL, completed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_milestones_tenant_project ON milestones(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  invoice_number TEXT, project_id TEXT, amount NUMERIC,
  tax_amount NUMERIC, total_amount NUMERIC, status TEXT NOT NULL,
  due_date TEXT, issue_date TEXT, description TEXT, created_at TEXT,
  seller_name TEXT, seller_address TEXT, seller_siret TEXT,
  seller_vat_number TEXT, seller_iban TEXT, seller_bic TEXT,
  vat_rate NUMERIC, zoho_invoice_id TEXT, invoice_type TEXT DEFAULT 'standard',
  mission_id TEXT, mission_name TEXT, advancement_pct NUMERIC DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_project ON invoices(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT, quantity NUMERIC, unit_price NUMERIC, vat_rate NUMERIC
);

CREATE TABLE IF NOT EXISTS project_cotraitants (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL, contact_id TEXT
);

CREATE TABLE IF NOT EXISTS project_stakeholders (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL, contact_id TEXT
);

CREATE TABLE IF NOT EXISTS project_lots (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  lot_number TEXT NOT NULL, lot_title TEXT NOT NULL, contact_id TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  progress INTEGER DEFAULT 0, dependencies TEXT
);

CREATE TABLE IF NOT EXISTS specifications (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, title TEXT NOT NULL, content TEXT,
  last_updated TEXT, is_template INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_specifications_tenant_project ON specifications(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS ordres_de_service (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, os_number TEXT NOT NULL, march_number TEXT,
  title TEXT NOT NULL, date TEXT NOT NULL, description TEXT,
  lot TEXT, status TEXT DEFAULT 'draft', type TEXT DEFAULT 'travaux',
  maitrise_oeuvre_adresse TEXT, entreprise TEXT, origine_demande TEXT,
  montant_marche_ht NUMERIC, objet TEXT, date_fourniture TEXT,
  article_ccap TEXT, incidences_delais_type TEXT, incidences_delais_details TEXT,
  incidences_couts_type TEXT, montant_devis_presente NUMERIC,
  montant_devis_accepte NUMERIC, date_signature TEXT
);
CREATE INDEX IF NOT EXISTS idx_ordres_de_service_tenant_project ON ordres_de_service(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS site_reports (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, date TEXT NOT NULL, report_number INTEGER NOT NULL,
  page_format TEXT, stakeholders TEXT, companies TEXT,
  meeting_notes TEXT, next_meeting TEXT, meteo TEXT,
  temperature TEXT, effectif_total TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_reports_tenant_project ON site_reports(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS site_report_notes (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  report_id TEXT REFERENCES site_reports(id) ON DELETE CASCADE,
  category TEXT NOT NULL, note_number INTEGER NOT NULL,
  responsible_company TEXT, issue_date TEXT NOT NULL,
  due_date TEXT, realization_date TEXT, status TEXT DEFAULT 'open',
  text TEXT, lot_concerne TEXT, photo_url TEXT, position TEXT,
  description TEXT, statut TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_report_notes_tenant_report ON site_report_notes(tenant_id, report_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, name TEXT NOT NULL, category TEXT NOT NULL,
  phase TEXT,
  version INTEGER DEFAULT 1, file_url TEXT NOT NULL,
  uploaded_by TEXT, uploaded_at TEXT NOT NULL, description TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_project ON documents(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, file_url TEXT NOT NULL,
  uploaded_by TEXT, uploaded_at TEXT NOT NULL, description TEXT
);
CREATE INDEX IF NOT EXISTS idx_document_versions_tenant_document ON document_versions(tenant_id, document_id);

CREATE TABLE IF NOT EXISTS visas (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, title TEXT NOT NULL, date TEXT NOT NULL,
  status TEXT DEFAULT 'pending', comments TEXT, document_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_visas_tenant_project ON visas(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS receptions (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, date TEXT NOT NULL, type TEXT NOT NULL,
  has_reserves INTEGER DEFAULT 0, reserves_count INTEGER DEFAULT 0,
  document_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_receptions_tenant_project ON receptions(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, name TEXT NOT NULL, file_url TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_tenant_project ON plans(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS reserves (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, reception_id TEXT, title TEXT NOT NULL,
  batiment TEXT, local TEXT, status TEXT DEFAULT 'A faire',
  lots TEXT, entreprises TEXT, created_at TEXT, due_date TEXT,
  plan_id TEXT, x NUMERIC, y NUMERIC, number INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reserves_tenant_project ON reserves(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS dpgf_items (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, designation TEXT NOT NULL, unite TEXT NOT NULL,
  quantite_prevue NUMERIC NOT NULL, prix_unitaire_ht NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dpgf_items_tenant_project ON dpgf_items(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS situations (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, numero_situation INTEGER NOT NULL,
  date_situation TEXT NOT NULL, etat TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_situations_tenant_project ON situations(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS detail_situations (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  situation_id TEXT REFERENCES situations(id) ON DELETE CASCADE,
  dpgf_item_id TEXT, pourcentage_avancement NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS cctps (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, data TEXT
);

CREATE TABLE IF NOT EXISTS dpgfs (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT, cctp_id TEXT, data TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL UNIQUE,
  agency_name TEXT, address TEXT, phone TEXT, email TEXT,
  siret TEXT, vat_number TEXT, currency TEXT, language TEXT,
  sender_option TEXT, default_email_template TEXT, logo_url TEXT,
  seller_iban TEXT, seller_bic TEXT,
  smtp_host TEXT, smtp_port TEXT, smtp_user TEXT, smtp_pass TEXT,
  zoho_client_id TEXT, zoho_client_secret TEXT, zoho_org_id TEXT,
  zoho_data_center TEXT, zoho_refresh_token TEXT,
  zoho_books_org_id TEXT,
  num_prefix_devis TEXT DEFAULT 'DEVIS',
  num_prefix_facture TEXT DEFAULT 'FAC',
  num_prefix_honoraires TEXT DEFAULT 'NH'
);

-- Project Templates
CREATE TABLE IF NOT EXISTS project_templates (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_status TEXT DEFAULT 'Planning',
  default_budget NUMERIC DEFAULT 0,
  default_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ACT Data (Analyse Comparative des Offres)
CREATE TABLE IF NOT EXISTS act_data (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  companies JSONB DEFAULT '[]',
  lots JSONB DEFAULT '[]',
  scoring_criteria JSONB DEFAULT '[]',
  weights JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DET Data (Comptes Rendus de Réunions)
CREATE TABLE IF NOT EXISTS det_data (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id TEXT NOT NULL,
  info JSONB DEFAULT '{}',
  observations JSONB DEFAULT '[]',
  intervenants JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tables complémentaires DPGF/CCTP
CREATE TABLE IF NOT EXISTS lignes_ouvrages (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  lot_id TEXT, designation TEXT, unite TEXT,
  quantite NUMERIC, prix_unitaire NUMERIC, article_id TEXT
);

CREATE TABLE IF NOT EXISTS articles_type (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  designation TEXT, unite TEXT, prix_unitaire NUMERIC, categorie TEXT
);

CREATE TABLE IF NOT EXISTS project_members (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_tenant_id  ON project_members(tenant_id);

CREATE TABLE IF NOT EXISTS custom_references (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name              TEXT NOT NULL,
  client            TEXT,
  category          TEXT,
  end_date          DATE,
  surface           NUMERIC,
  budget            NUMERIC,
  status            TEXT DEFAULT 'Completed',
  description       TEXT,
  image_url         TEXT,
  location          TEXT,
  start_date        DATE,
  project_manager   TEXT,
  construction_cost NUMERIC,
  remuneration      NUMERIC,
  progression       NUMERIC,
  custom_data       JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_references_tenant_id ON custom_references(tenant_id);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

-- Activer RLS sur toutes les tables métier
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
ALTER TABLE project_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE act_data             ENABLE ROW LEVEL SECURITY;
ALTER TABLE det_data              ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests        ENABLE ROW LEVEL SECURITY;

-- Helper function : tenant_id du user connecté
CREATE OR REPLACE FUNCTION my_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
$$;

-- Politique générique : chaque user ne voit que les données de son tenant
-- On applique la même logique à toutes les tables avec tenant_id

CREATE POLICY "tenant_isolation" ON contacts
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON contact_categories
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON project_categories
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON projects
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON team_members
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON tenders
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON tender_specialties
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON proposals
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON proposal_specialties
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON milestones
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON invoices
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON invoice_items
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON project_cotraitants
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON project_stakeholders
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON project_lots
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON tasks
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON specifications
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON ordres_de_service
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON site_reports
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON site_report_notes
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON documents
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON document_versions
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON visas
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON receptions
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON plans
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON reserves
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON dpgf_items
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON situations
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON detail_situations
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON cctps
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON dpgfs
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON settings
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON lignes_ouvrages
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON articles_type
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON project_templates
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON act_data
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON det_data
  USING (tenant_id = my_tenant_id());

-- Jonctions : visibles si le projet parent l'est
CREATE POLICY "tenant_isolation" ON project_categories_junction
  USING (project_id IN (SELECT id FROM projects WHERE tenant_id = my_tenant_id()));
CREATE POLICY "tenant_isolation" ON project_team
  USING (project_id IN (SELECT id FROM projects WHERE tenant_id = my_tenant_id()));

-- Profiles : chaque user voit son propre profil + ceux de son tenant
CREATE POLICY "own_profile" ON profiles
  USING (id = auth.uid() OR tenant_id = my_tenant_id());

-- Tenants : visible par ses membres uniquement
CREATE POLICY "own_tenant" ON tenants
  USING (id = my_tenant_id());

-- Join requests : visible par le demandeur ou les membres du tenant visé
CREATE POLICY "tenant_isolation" ON join_requests
  USING (tenant_id = my_tenant_id() OR user_id = auth.uid());

-- Activity Feed tables
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  target TEXT,
  target_id TEXT,
  target_type TEXT,
  category TEXT,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_posts (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT,
  user_name TEXT,
  content TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_comments (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  post_id TEXT REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id TEXT,
  user_name TEXT,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_likes (
  id TEXT PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  user_id TEXT
);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON activities USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON feed_posts USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON feed_comments USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON feed_likes USING (tenant_id = my_tenant_id());
