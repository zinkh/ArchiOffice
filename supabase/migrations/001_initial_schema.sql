-- ArchiOffice — PostgreSQL schema migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  prefix TEXT, first_name TEXT NOT NULL, middle_name TEXT,
  last_name TEXT NOT NULL, suffix TEXT, nickname TEXT,
  company_name TEXT, job_title TEXT, department TEXT,
  email TEXT, email_work TEXT, email_home TEXT, email_other TEXT,
  phone TEXT, phone_mobile TEXT, phone_work TEXT, phone_home TEXT,
  phone_main TEXT, phone_fax_work TEXT, phone_fax_home TEXT,
  phone_pager TEXT, phone_other TEXT,
  market_number TEXT, market_amount_base NUMERIC, market_amount_options NUMERIC,
  market_amount_avenants NUMERIC,
  address TEXT, zip TEXT, city TEXT, state TEXT, country TEXT,
  address_work_street TEXT, address_work_city TEXT, address_work_state TEXT,
  address_work_zip TEXT, address_work_country TEXT,
  address_home_street TEXT, address_home_city TEXT, address_home_state TEXT,
  address_home_zip TEXT, address_home_country TEXT,
  candidatures TEXT, affaires TEXT, logo TEXT, ca_amount NUMERIC,
  electronic_signature TEXT, contact_references TEXT, tags TEXT,
  category TEXT, notes TEXT, birthday TEXT, website TEXT,
  created_at TEXT, created_by TEXT, siret TEXT, vat_number TEXT
);

CREATE TABLE IF NOT EXISTS project_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS contact_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT UNIQUE,
  avatar TEXT,
  system_role TEXT DEFAULT 'user',
  auth_user_id TEXT UNIQUE,       -- links to auth.users(id)
  senderOption TEXT,
  defaultEmailTemplate TEXT
  -- password column intentionally omitted: auth handled by Supabase Auth
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  client_id TEXT REFERENCES contacts(id),
  status TEXT NOT NULL,
  budget NUMERIC,
  category TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  image_url TEXT,
  project_code TEXT,
  address TEXT,
  client_siret TEXT,
  client_vat_number TEXT,
  client_email TEXT,
  is_public_client BOOLEAN DEFAULT FALSE,
  reference TEXT, projet_detail TEXT,
  is_entreprise BOOLEAN DEFAULT FALSE,
  nom_societe TEXT, rcs TEXT, representant TEXT, qualite TEXT,
  adresse_client TEXT, cp_client TEXT, ville_client TEXT,
  telephone TEXT, portable TEXT, email_client TEXT,
  adresse_terrain TEXT, cp_ville_terrain TEXT,
  ban_id_terrain TEXT, city_code_terrain TEXT,
  ref_cadastrale TEXT, zone_plu TEXT, surface_parcelle TEXT,
  nom_etablissement TEXT, avant_trav TEXT, apres_trav TEXT,
  type_et_cat TEXT, type_projet TEXT, categorie_projet TEXT,
  surface_plancher TEXT, surface_plancher_ext TEXT,
  surface_erp TEXT, surface_ert TEXT,
  effectif_public TEXT, effectif_personnel TEXT,
  ind TEXT, date_modification TEXT,
  -- columns added via ALTER TABLE in original SQLite migration
  is_complete_mission BOOLEAN DEFAULT FALSE,
  is_chantier BOOLEAN DEFAULT FALSE,
  etudes_notes TEXT, chantier_notes TEXT,
  surface TEXT, construction_cost NUMERIC, remuneration NUMERIC,
  progression NUMERIC, project_manager TEXT,
  cotraitants TEXT, external_intervenants TEXT, entreprises TEXT,
  lots_list TEXT   -- JSON stored as TEXT (project lots summary)
);

CREATE TABLE IF NOT EXISTS project_categories_junction (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES project_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)
);

CREATE TABLE IF NOT EXISTS project_team (
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, member_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id TEXT,
  tender_id TEXT,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tenders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client TEXT NOT NULL,
  submission_deadline TEXT NOT NULL,
  status TEXT NOT NULL,
  value NUMERIC,
  notes TEXT,
  mandataire_id TEXT REFERENCES contacts(id),
  type TEXT,
  surface NUMERIC,
  construction_cost NUMERIC,
  honoraires_percent NUMERIC,
  mandatory_visit BOOLEAN DEFAULT FALSE,
  visit_date TEXT,
  withdrawal_deadline TEXT,
  archived BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tender_specialties (
  id TEXT PRIMARY KEY,
  tender_id TEXT REFERENCES tenders(id) ON DELETE CASCADE,
  specialty_name TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS specifications (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  last_updated TEXT,
  is_template BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client_id TEXT REFERENCES contacts(id),
  amount NUMERIC,
  status TEXT NOT NULL,
  description TEXT,
  created_at TEXT,
  reference TEXT, projet_detail TEXT,
  is_entreprise BOOLEAN DEFAULT FALSE,
  nom_societe TEXT, rcs TEXT, representant TEXT, qualite TEXT,
  adresse_client TEXT, cp_client TEXT, ville_client TEXT,
  telephone TEXT, portable TEXT, email_client TEXT,
  adresse_terrain TEXT, cp_ville_terrain TEXT,
  ref_cadastrale TEXT, zone_plu TEXT, surface_parcelle TEXT,
  nom_etablissement TEXT, avant_trav TEXT, apres_trav TEXT,
  type_et_cat TEXT, type_projet TEXT, categorie_projet TEXT,
  surface_plancher TEXT, surface_plancher_ext TEXT,
  surface_erp TEXT, surface_ert TEXT,
  effectif_public TEXT, effectif_personnel TEXT,
  ind TEXT, date_modification TEXT,
  project_code TEXT, project_number TEXT, project_status TEXT,
  keywords TEXT, notes TEXT,
  site_name TEXT, site_description TEXT, site_id TEXT,
  site_address_1 TEXT, site_address_2 TEXT, site_address_3 TEXT,
  site_postbox TEXT, site_city TEXT, site_state TEXT,
  site_postcode TEXT, site_country TEXT,
  site_gross_perimeter TEXT, site_gross_area TEXT,
  building_name TEXT, building_description TEXT, building_id TEXT,
  contact_fullname TEXT, contact_prefixtitle TEXT, contact_givenname TEXT,
  contact_middlename TEXT, contact_familyname TEXT,
  contact_suffixtitle TEXT, contact_nameorder TEXT,
  contact_id TEXT, contact_role TEXT, contact_department TEXT,
  contact_company TEXT, contact_companycode TEXT, contact_fulladdress TEXT,
  contact_address_1 TEXT, contact_address_2 TEXT, contact_address_3 TEXT,
  contact_postbox TEXT, contact_city TEXT, contact_state TEXT,
  contact_postcode TEXT, contact_country TEXT,
  contact_email TEXT, contact_phone TEXT, contact_fax TEXT, contact_web TEXT,
  cad_technician_fullname TEXT, cad_technician_prefixtitle TEXT,
  cad_technician_givenname TEXT, cad_technician_middlename TEXT,
  cad_technician_familyname TEXT, cad_technician_suffixtitle TEXT,
  cad_technician_nameorder TEXT,
  client_fullname TEXT, client_prefixtitle TEXT, client_givenname TEXT,
  client_middlename TEXT, client_familyname TEXT,
  client_suffixtitle TEXT, client_nameorder TEXT,
  client_company TEXT, client_fulladdress TEXT,
  client_address_1 TEXT, client_address_2 TEXT, client_address_3 TEXT,
  client_postbox TEXT, client_city TEXT, client_state TEXT,
  client_postcode TEXT, client_country TEXT,
  client_email TEXT, client_phone TEXT, client_fax TEXT,
  ed_report_header TEXT, custom_building TEXT, custom_architect TEXT,
  custom_client TEXT, fee_distribution TEXT,
  construction_cost NUMERIC, complexity_rate NUMERIC,
  base_fee_percent NUMERIC, exe_fee_percent NUMERIC,
  comp_fee_percent NUMERIC, vat_rate NUMERIC, decimal_precision INTEGER
);

CREATE TABLE IF NOT EXISTS proposal_specialties (
  id TEXT PRIMARY KEY,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE CASCADE,
  specialty_name TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  amount NUMERIC,
  tax_amount NUMERIC,
  total_amount NUMERIC,
  status TEXT NOT NULL,
  due_date TEXT,
  issue_date TEXT,
  description TEXT,
  created_at TEXT,
  seller_name TEXT, seller_address TEXT, seller_siret TEXT,
  seller_vat_number TEXT, seller_iban TEXT, seller_bic TEXT,
  vat_rate NUMERIC
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT,
  quantity NUMERIC,
  unit_price NUMERIC,
  vat_rate NUMERIC
);

CREATE TABLE IF NOT EXISTS ordres_de_service (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  os_number TEXT NOT NULL,
  march_number TEXT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  lot TEXT,
  status TEXT DEFAULT 'draft',
  maitrise_oeuvre TEXT,
  maitrise_oeuvre_adresse TEXT,
  entreprise TEXT,
  origine_demande TEXT,
  montant_marche_ht NUMERIC,
  objet TEXT,
  date_fourniture TEXT,
  article_ccap TEXT,
  incidences_delais_type TEXT,
  incidences_delais_details TEXT,
  incidences_couts_type TEXT,
  montant_devis_presente NUMERIC,
  montant_devis_accepte NUMERIC,
  montant TEXT,
  date_signature TEXT
);

CREATE TABLE IF NOT EXISTS project_cotraitants (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS project_stakeholders (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS project_lots (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  lot_number TEXT NOT NULL,
  lot_title TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  dependencies TEXT
);

CREATE TABLE IF NOT EXISTS site_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  report_number INTEGER NOT NULL,
  pageFormat TEXT,
  stakeholders TEXT,
  companies TEXT,
  meetingNotes TEXT,
  nextMeeting TEXT,
  meteo TEXT,
  temperature TEXT,
  effectif_total TEXT
);

CREATE TABLE IF NOT EXISTS site_report_notes (
  id TEXT PRIMARY KEY,
  report_id TEXT REFERENCES site_reports(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  note_number INTEGER NOT NULL,
  responsible_company TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  realization_date TEXT,
  status TEXT DEFAULT 'open',
  text TEXT,
  lot_concerne TEXT,
  photo_url TEXT,
  position TEXT,
  description TEXT,
  statut TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  file_url TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS visas (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  comments TEXT,
  document_url TEXT
);

CREATE TABLE IF NOT EXISTS receptions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  has_reserves BOOLEAN DEFAULT FALSE,
  reserves_count INTEGER DEFAULT 0,
  document_url TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reserves (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  reception_id TEXT REFERENCES receptions(id),
  plan_id TEXT REFERENCES plans(id),
  title TEXT NOT NULL,
  batiment TEXT, local TEXT,
  status TEXT DEFAULT 'A faire',
  lots TEXT, entreprises TEXT,
  created_at TEXT, due_date TEXT,
  x NUMERIC, y NUMERIC, number INTEGER
);

CREATE TABLE IF NOT EXISTS dpgf_items (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  designation TEXT NOT NULL,
  unite TEXT NOT NULL,
  quantite_prevue NUMERIC NOT NULL,
  prix_unitaire_ht NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS situations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  numero_situation INTEGER NOT NULL,
  date_situation TEXT NOT NULL,
  etat TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS detail_situations (
  id TEXT PRIMARY KEY,
  situation_id TEXT REFERENCES situations(id) ON DELETE CASCADE,
  dpgf_item_id TEXT REFERENCES dpgf_items(id),
  pourcentage_avancement NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS cctps (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  data TEXT
);

CREATE TABLE IF NOT EXISTS dpgfs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  cctp_id TEXT REFERENCES cctps(id),
  data TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  "agencyName" TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  siret TEXT,
  "vatNumber" TEXT,
  currency TEXT,
  language TEXT,
  "senderOption" TEXT,
  "defaultEmailTemplate" TEXT,
  "logoUrl" TEXT,
  seller_iban TEXT,
  seller_bic TEXT,
  "smtpHost" TEXT,
  "smtpPort" TEXT,
  "smtpUser" TEXT,
  "smtpPass" TEXT
);

-- ─── Seed Data ────────────────────────────────────────────────────────────────

INSERT INTO project_categories (id, name) VALUES
  ('pcat1','Residential'),('pcat2','Commercial'),('pcat3','Renovation'),
  ('pcat4','Industrial'),('pcat5','Public')
ON CONFLICT (id) DO NOTHING;

INSERT INTO contact_categories (id, name) VALUES
  ('cat1','Architecte d''Intérieur'),('cat2','Architectes'),('cat3','Artisan'),
  ('cat4','Artiste'),('cat5','BIM Manager'),('cat6','Bureau d''Etudes'),
  ('cat7','Constructeur Maisons Individueles'),('cat8','Contractant général'),
  ('cat9','Contrôleur Technique'),('cat10','Courtier en Travaux'),
  ('cat11','Designer'),('cat12','Diagnostics Immobiliers'),
  ('cat13','Détection Réseaux'),('cat14','Entreprise'),
  ('cat15','Entreprise Générale'),('cat16','Graphiste'),
  ('cat17','Géomètre-expert'),('cat18','Géotechnicien'),
  ('cat19','Historienne du Patrimoine'),('cat20','Maître d''Ouvrages'),
  ('cat21','Maître d''œuvre'),('cat22','Maîtrise d''Usage - Concertation'),
  ('cat23','Paysagiste'),('cat24','Photographe'),('cat25','Promoteur'),
  ('cat26','Urbaniste')
ON CONFLICT (id) DO NOTHING;

INSERT INTO contacts (id, first_name, last_name, company_name, email, category, city) VALUES
  ('c1','Jean','Dupont','Dupont Architecture','jean@dupont-archi.fr','Architectes','Paris'),
  ('c2','Marie','Curie','Ville de Paris','marie.curie@paris.fr','Maître d''Ouvrages','Paris'),
  ('c3','Pierre','Martin','BET Structure','pierre@bet-structure.com','Bureau d''Etudes','Lyon'),
  ('c4','Sophie','Bernard','Bernard Design','sophie@bernard-design.fr','Designer','Marseille'),
  ('c5','Thomas','Petit','Petit Promoteur','thomas@petit-immo.fr','Promoteur','Bordeaux')
ON CONFLICT (id) DO NOTHING;

-- ─── Storage bucket ───────────────────────────────────────────────────────────
-- Creates a public bucket for uploads (plans, documents)
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload/read files
CREATE POLICY "Authenticated users can upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "Anyone can read uploads" ON storage.objects
  FOR SELECT USING (bucket_id = 'uploads');

CREATE POLICY "Authenticated users can delete own uploads" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'uploads');

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS on all tables (server uses secret key so it bypasses RLS)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write everything (server enforces finer access)
CREATE POLICY "Authenticated full access" ON projects TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON contacts TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON team_members TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON milestones TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON tenders TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON specifications TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON proposals TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON invoices TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON settings TO authenticated USING (true) WITH CHECK (true);
