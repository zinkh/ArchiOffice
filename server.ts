import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { proposalToXml, xmlToProposal } from "./src/lib/xmlHelper.js";
import multer from "multer";
import fs from "fs";

// Helper for fetching with timeout
async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage: storage });

dotenv.config();

const db = new Database("archimanager.db");

try {
  // Initialize database
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client TEXT NOT NULL,
      client_id TEXT,
      status TEXT NOT NULL,
      budget REAL,
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
      is_public_client INTEGER DEFAULT 0,
      FOREIGN KEY(client_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS ordres_de_service (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      os_number TEXT NOT NULL,
      march_number TEXT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      lot TEXT,
      status TEXT DEFAULT 'draft',
      maitrise_oeuvre_adresse TEXT,
      entreprise TEXT,
      origine_demande TEXT,
      montant_marche_ht REAL,
      objet TEXT,
      date_fourniture TEXT,
      article_ccap TEXT,
      incidences_delais_type TEXT,
      incidences_delais_details TEXT,
      incidences_couts_type TEXT,
      montant_devis_presente REAL,
      montant_devis_accepte REAL,
      date_signature TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS project_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS project_categories_junction (
      project_id TEXT,
      category_id TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(category_id) REFERENCES project_categories(id),
      PRIMARY KEY(project_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      email TEXT,
      avatar TEXT,
      system_role TEXT DEFAULT 'user'
    );

    CREATE TABLE IF NOT EXISTS project_team (
      project_id TEXT,
      member_id TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(member_id) REFERENCES team_members(id)
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      proposal_id TEXT,
      tender_id TEXT,
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(proposal_id) REFERENCES proposals(id),
      FOREIGN KEY(tender_id) REFERENCES tenders(id)
    );

    CREATE TABLE IF NOT EXISTS tenders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      client TEXT NOT NULL,
      submission_deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      value REAL,
      notes TEXT,
      mandataire_id TEXT,
      type TEXT,
      surface REAL,
      construction_cost REAL,
      honoraires_percent REAL,
      mandatory_visit INTEGER DEFAULT 0,
      visit_date TEXT,
      withdrawal_deadline TEXT,
      FOREIGN KEY(mandataire_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS tender_specialties (
      id TEXT PRIMARY KEY,
      tender_id TEXT,
      specialty_name TEXT NOT NULL,
      contact_id TEXT,
      FOREIGN KEY(tender_id) REFERENCES tenders(id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS specifications (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      content TEXT, -- JSON string of spec sections
      last_updated TEXT,
      is_template INTEGER DEFAULT 0,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      prefix TEXT,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      nickname TEXT,
      company_name TEXT,
      job_title TEXT,
      department TEXT,
      email_work TEXT,
      email_home TEXT,
      email_other TEXT,
      email TEXT,
      phone_mobile TEXT,
      phone_work TEXT,
      market_number TEXT,
      market_amount_base REAL,
      market_amount_options REAL,
      market_amount_avenants REAL,
      phone_home TEXT,
      phone_main TEXT,
      phone_fax_work TEXT,
      phone_fax_home TEXT,
      phone_pager TEXT,
      phone_other TEXT,
      phone TEXT,
      address_work_street TEXT,
      address_work_city TEXT,
      address_work_state TEXT,
      address_work_zip TEXT,
      address_work_country TEXT,
      address_home_street TEXT,
      address_home_city TEXT,
      address_home_state TEXT,
      address_home_zip TEXT,
      address_home_country TEXT,
      address TEXT,
      zip TEXT,
      city TEXT,
      state TEXT,
      country TEXT,
      candidatures TEXT,
      affaires TEXT,
      logo TEXT,
      ca_amount REAL,
      electronic_signature TEXT,
      contact_references TEXT,
      tags TEXT,
      category TEXT,
      notes TEXT,
      birthday TEXT,
      website TEXT,
      created_at TEXT,
      created_by TEXT,
      siret TEXT,
      vat_number TEXT
    );

    CREATE TABLE IF NOT EXISTS contact_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      client_id TEXT,
      amount REAL,
      status TEXT NOT NULL,
      description TEXT,
      created_at TEXT,
      reference TEXT,
      projet_detail TEXT,
      is_entreprise INTEGER DEFAULT 0,
      nom_societe TEXT,
      rcs TEXT,
      representant TEXT,
      qualite TEXT,
      adresse_client TEXT,
      cp_client TEXT,
      ville_client TEXT,
      telephone TEXT,
      portable TEXT,
      email_client TEXT,
      adresse_terrain TEXT,
      cp_ville_terrain TEXT,
      ref_cadastrale TEXT,
      zone_plu TEXT,
      surface_parcelle TEXT,
      nom_etablissement TEXT,
      avant_trav TEXT,
      apres_trav TEXT,
      type_et_cat TEXT,
      type_projet TEXT,
      categorie_projet TEXT,
      surface_plancher TEXT,
      surface_plancher_ext TEXT,
      surface_erp TEXT,
      surface_ert TEXT,
      effectif_public TEXT,
      effectif_personnel TEXT,
      ind TEXT,
      date_modification TEXT,
      
      -- New XML fields
      project_code TEXT,
      project_number TEXT,
      project_status TEXT,
      keywords TEXT,
      notes TEXT,
      site_name TEXT,
      site_description TEXT,
      site_id TEXT,
      site_address_1 TEXT,
      site_address_2 TEXT,
      site_address_3 TEXT,
      site_postbox TEXT,
      site_city TEXT,
      site_state TEXT,
      site_postcode TEXT,
      site_country TEXT,
      site_gross_perimeter TEXT,
      site_gross_area TEXT,
      building_name TEXT,
      building_description TEXT,
      building_id TEXT,
      contact_fullname TEXT,
      contact_prefixtitle TEXT,
      contact_givenname TEXT,
      contact_middlename TEXT,
      contact_familyname TEXT,
      contact_suffixtitle TEXT,
      contact_nameorder TEXT,
      contact_id TEXT,
      contact_role TEXT,
      contact_department TEXT,
      contact_company TEXT,
      contact_companycode TEXT,
      contact_fulladdress TEXT,
      contact_address_1 TEXT,
      contact_address_2 TEXT,
      contact_address_3 TEXT,
      contact_postbox TEXT,
      contact_city TEXT,
      contact_state TEXT,
      contact_postcode TEXT,
      contact_country TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      contact_fax TEXT,
      contact_web TEXT,
      cad_technician_fullname TEXT,
      cad_technician_prefixtitle TEXT,
      cad_technician_givenname TEXT,
      cad_technician_middlename TEXT,
      cad_technician_familyname TEXT,
      cad_technician_suffixtitle TEXT,
      cad_technician_nameorder TEXT,
      client_fullname TEXT,
      client_prefixtitle TEXT,
      client_givenname TEXT,
      client_middlename TEXT,
      client_familyname TEXT,
      client_suffixtitle TEXT,
      client_nameorder TEXT,
      client_company TEXT,
      client_fulladdress TEXT,
      client_address_1 TEXT,
      client_address_2 TEXT,
      client_address_3 TEXT,
      client_postbox TEXT,
      client_city TEXT,
      client_state TEXT,
      client_postcode TEXT,
      client_country TEXT,
      client_email TEXT,
      client_phone TEXT,
      client_fax TEXT,
      ed_report_header TEXT,
      custom_building TEXT,
      custom_architect TEXT,
      custom_client TEXT,

      FOREIGN KEY(client_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT,
      project_id TEXT,
      amount REAL,
      tax_amount REAL,
      total_amount REAL,
      status TEXT NOT NULL,
      due_date TEXT,
      issue_date TEXT,
      description TEXT,
      created_at TEXT,
      seller_name TEXT,
      seller_address TEXT,
      seller_siret TEXT,
      seller_vat_number TEXT,
      seller_iban TEXT,
      seller_bic TEXT,
      vat_rate REAL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT,
      description TEXT,
      quantity REAL,
      unit_price REAL,
      vat_rate REAL,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS project_cotraitants (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      specialty TEXT NOT NULL,
      contact_id TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS project_stakeholders (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      contact_id TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS proposal_specialties (
      id TEXT PRIMARY KEY,
      proposal_id TEXT,
      specialty_name TEXT NOT NULL,
      contact_id TEXT,
      FOREIGN KEY(proposal_id) REFERENCES proposals(id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS project_lots (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      lot_number TEXT NOT NULL,
      lot_title TEXT NOT NULL,
      contact_id TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      dependencies TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS site_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      date TEXT NOT NULL,
      report_number INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS site_report_notes (
      id TEXT PRIMARY KEY,
      report_id TEXT,
      category TEXT NOT NULL,
      note_number INTEGER NOT NULL,
      responsible_company TEXT,
      issue_date TEXT NOT NULL,
      due_date TEXT,
      realization_date TEXT,
      status TEXT DEFAULT 'open',
      FOREIGN KEY(report_id) REFERENCES site_reports(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      file_url TEXT NOT NULL,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      version INTEGER NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS visas (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      comments TEXT,
      document_url TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS receptions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      has_reserves INTEGER DEFAULT 0,
      reserves_count INTEGER DEFAULT 0,
      document_url TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS reserves (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      reception_id TEXT,
      title TEXT NOT NULL,
      batiment TEXT,
      local TEXT,
      status TEXT DEFAULT 'A faire',
      lots TEXT, -- JSON array
      entreprises TEXT, -- JSON array
      created_at TEXT,
      due_date TEXT,
      plan_id TEXT,
      x REAL,
      y REAL,
      number INTEGER,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(reception_id) REFERENCES receptions(id),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS dpgf_items (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      designation TEXT NOT NULL,
      unite TEXT NOT NULL,
      quantite_prevue REAL NOT NULL,
      prix_unitaire_ht REAL NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS situations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      numero_situation INTEGER NOT NULL,
      date_situation TEXT NOT NULL,
      etat TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS detail_situations (
      id TEXT PRIMARY KEY,
      situation_id TEXT,
      dpgf_item_id TEXT,
      pourcentage_avancement REAL NOT NULL,
      FOREIGN KEY(situation_id) REFERENCES situations(id),
      FOREIGN KEY(dpgf_item_id) REFERENCES dpgf_items(id)
    );

    CREATE TABLE IF NOT EXISTS cctps (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      data TEXT, -- JSON string of CCTP structure
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS dpgfs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      cctp_id TEXT,
      data TEXT, -- JSON string of DPGF structure
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(cctp_id) REFERENCES cctps(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      agencyName TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      siret TEXT,
      vatNumber TEXT,
      currency TEXT,
      language TEXT,
      senderOption TEXT,
      defaultEmailTemplate TEXT,
      logoUrl TEXT,
      seller_iban TEXT,
      seller_bic TEXT
    );
  `);

  // Add columns if they don't exist (for existing databases)
  const tablesToUpdate = [
    { table: 'projects', columns: ['category', 'image_url', 'project_code', 'address', 'client_id', 'client_siret', 'client_vat_number', 'client_email', 'is_public_client', 'is_complete_mission', 'is_chantier', 'etudes_notes', 'chantier_notes', 'surface', 'construction_cost', 'remuneration', 'progression', 'project_manager', 'cotraitants', 'external_intervenants', 'entreprises'] },
    { table: 'milestones', columns: ['proposal_id', 'tender_id'] },
    { table: 'site_reports', columns: ['pageFormat', 'stakeholders', 'companies', 'meetingNotes', 'nextMeeting'] },
    { table: 'contacts', columns: [
      'prefix', 'middle_name', 'suffix', 'nickname', 'job_title', 'department', 
      'email_work', 'email_home', 'email_other', 
      'phone_mobile', 'phone_work', 'phone_home', 'phone_main', 'phone_fax_work', 'phone_fax_home', 'phone_pager', 'phone_other',
      'address_work_street', 'address_work_city', 'address_work_state', 'address_work_zip', 'address_work_country',
      'address_home_street', 'address_home_city', 'address_home_state', 'address_home_zip', 'address_home_country',
      'notes', 'birthday', 'category', 'company_name', 'siret', 'vat_number', 'website'
    ] },
    { table: 'team_members', columns: ['system_role', 'senderOption', 'defaultEmailTemplate'] },
    { table: 'invoices', columns: ['invoice_number', 'tax_amount', 'total_amount', 'issue_date', 'seller_name', 'seller_address', 'seller_siret', 'seller_vat_number', 'seller_iban', 'seller_bic', 'vat_rate'] },
    { table: 'tenders', columns: ['mandataire_id', 'type', 'surface', 'construction_cost', 'honoraires_percent', 'mandatory_visit', 'visit_date', 'withdrawal_deadline'] },
    { table: 'proposals', columns: [
      'reference', 'projet_detail', 'is_entreprise', 'nom_societe', 'rcs', 'representant', 'qualite', 
      'adresse_client', 'cp_client', 'ville_client', 'telephone', 'portable', 'email_client', 
      'adresse_terrain', 'cp_ville_terrain', 'ref_cadastrale', 'zone_plu', 'surface_parcelle', 
      'nom_etablissement', 'avant_trav', 'apres_trav', 'type_et_cat', 'type_projet', 
      'categorie_projet', 'surface_plancher', 'surface_plancher_ext', 'surface_erp', 
      'surface_ert', 'effectif_public', 'effectif_personnel', 'ind', 'date_modification',
      'project_code', 'project_number', 'project_status', 'keywords', 'notes',
      'site_name', 'site_description', 'site_id', 'site_address_1', 'site_address_2', 'site_address_3',
      'site_postbox', 'site_city', 'site_state', 'site_postcode', 'site_country', 'site_gross_perimeter', 'site_gross_area',
      'building_name', 'building_description', 'building_id',
      'contact_fullname', 'contact_prefixtitle', 'contact_givenname', 'contact_middlename', 'contact_familyname',
      'contact_suffixtitle', 'contact_nameorder', 'contact_id', 'contact_role', 'contact_department',
      'contact_company', 'contact_companycode', 'contact_fulladdress', 'contact_address_1', 'contact_address_2',
      'contact_address_3', 'contact_postbox', 'contact_city', 'contact_state', 'contact_postcode',
      'contact_country', 'contact_email', 'contact_phone', 'contact_fax', 'contact_web',
      'cad_technician_fullname', 'cad_technician_prefixtitle', 'cad_technician_givenname', 'cad_technician_middlename',
      'cad_technician_familyname', 'cad_technician_suffixtitle', 'cad_technician_nameorder',
      'client_fullname', 'client_prefixtitle', 'client_givenname', 'client_middlename', 'client_familyname',
      'client_suffixtitle', 'client_nameorder', 'client_company', 'client_fulladdress', 'client_address_1',
      'client_address_2', 'client_address_3', 'client_postbox', 'client_city', 'client_state',
      'client_postcode', 'client_country', 'client_email', 'client_phone', 'client_fax',
      'ed_report_header', 'custom_building', 'custom_architect', 'custom_client'
    ] },
    { table: 'ordres_de_service', columns: [
      'march_number', 'lot', 'maitrise_oeuvre_adresse', 'entreprise', 'origine_demande', 
      'montant_marche_ht', 'objet', 'date_fourniture', 'article_ccap', 'incidences_delais_type', 
      'incidences_delais_details', 'incidences_couts_type', 'montant_devis_presente', 
      'montant_devis_accepte', 'date_signature'
    ] },
    { table: 'reserves', columns: ['batiment', 'local', 'status', 'lots', 'entreprises', 'created_at', 'due_date', 'plan_id', 'x', 'y', 'number'] },
    { table: 'settings', columns: ['seller_iban', 'seller_bic'] }
  ];

  for (const { table, columns } of tablesToUpdate) {
    for (const column of columns) {
      try {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`).run();
      } catch (e) {
        // Column likely already exists
      }
    }
  }

  try {
    db.prepare(`ALTER TABLE specifications ADD COLUMN is_template INTEGER DEFAULT 0`).run();
  } catch (e) {
    // Column likely already exists
  }

  // Seed Data
  db.exec(`
    INSERT OR IGNORE INTO project_categories (id, name) VALUES 
    ('pcat1', 'Residential'),
    ('pcat2', 'Commercial'),
    ('pcat3', 'Renovation'),
    ('pcat4', 'Industrial'),
    ('pcat5', 'Public');

    INSERT OR IGNORE INTO contact_categories (id, name) VALUES 
    ('cat1', 'Architecte d''Intérieur'),
    ('cat2', 'Architectes'),
    ('cat3', 'Artisan'),
    ('cat4', 'Artiste'),
    ('cat5', 'BIM Manager'),
    ('cat6', 'Bureau d''Etudes'),
    ('cat7', 'Constructeur Maisons Individueles'),
    ('cat8', 'Contractant général'),
    ('cat9', 'Contrôleur Technique'),
    ('cat10', 'Courtier en Travaux'),
    ('cat11', 'Designer'),
    ('cat12', 'Diagnostics Immobiliers'),
    ('cat13', 'Détection Réseaux'),
    ('cat14', 'Entreprise'),
    ('cat15', 'Entreprise Générale'),
    ('cat16', 'Graphiste'),
    ('cat17', 'Géomètre-expert'),
    ('cat18', 'Géotechnicien'),
    ('cat19', 'Historienne du Patrimoine'),
    ('cat20', 'Maître d''Ouvrages'),
    ('cat21', 'Maître d''œuvre'),
    ('cat22', 'Maîtrise d''Usage - Concertation'),
    ('cat23', 'Paysagiste'),
    ('cat24', 'Photographe'),
    ('cat25', 'Promoteur'),
    ('cat26', 'Urbaniste');

    INSERT OR IGNORE INTO contacts (id, first_name, last_name, company_name, email, category, city) VALUES 
    ('c1', 'Jean', 'Dupont', 'Dupont Architecture', 'jean@dupont-archi.fr', 'Architectes', 'Paris'),
    ('c2', 'Marie', 'Curie', 'Ville de Paris', 'marie.curie@paris.fr', 'Maître d''Ouvrages', 'Paris'),
    ('c3', 'Pierre', 'Martin', 'BET Structure', 'pierre@bet-structure.com', 'Bureau d''Etudes', 'Lyon'),
    ('c4', 'Sophie', 'Bernard', 'Bernard Design', 'sophie@bernard-design.fr', 'Designer', 'Marseille'),
    ('c5', 'Thomas', 'Petit', 'Petit Promoteur', 'thomas@petit-immo.fr', 'Promoteur', 'Bordeaux');

    INSERT OR IGNORE INTO proposals (id, title, client_id, amount, status, description, created_at, reference) VALUES 
    ('prop1', 'Rénovation Appartement Haussmannien', 'c2', 12500, 'Accepted', 'Mission complète de maîtrise d''œuvre pour la rénovation d''un appartement de 120m²', '2023-10-15', 'PROP-2023-001'),
    ('prop2', 'Extension Maison Individuelle', 'c5', 8500, 'Pending', 'Étude de faisabilité et permis de construire pour une extension de 40m²', '2023-11-02', 'PROP-2023-002'),
    ('prop3', 'Aménagement Bureaux CCI', 'c1', 15000, 'Draft', 'Conception et suivi de travaux pour l''aménagement des nouveaux bureaux de la CCI', '2023-11-20', 'PROP-2023-003');

    INSERT OR IGNORE INTO projects (id, name, client, status, budget, start_date, end_date, description) VALUES 
    ('p1', 'Collège ARTEM', 'Enseignement', 'Completed', 18500000, '2016-01-01', '2018-11-07', 'Construction du Collège ARTEM'),
    ('p2', 'Lycée Heinrich-Nessel', 'Enseignement', 'Completed', 4200000, '2017-03-15', '2018-11-07', 'Ateliers du Lycée Heinrich-Nessel à Haguenau'),
    ('p3', 'Collège Vallée de l''Orne', 'Enseignement', 'In Progress', 12500000, '2023-06-01', '2026-11-07', 'Restructuration de l’externat. Création d’une demi-pension. Mise aux normes accessibilité PSH. Construction Neuve d’une galerie d’expositions.'),
    ('p4', 'Lycée Cormontaigne', 'Enseignement', 'In Progress', 6200000, '2024-01-01', '2026-11-07', 'Restructuration du bâtiment 3 - Ateliers, 6 200 m² SHON. Respect des 12 critères de préconisations HQE.'),
    ('p5', 'Collège de Custines', 'Enseignement', 'Planning', 9500000, '2025-05-01', '2027-11-07', 'Collège de Custines'),
    ('p6', 'ENSAD Nancy', 'Enseignement', 'In Progress', 24000000, '2024-01-01', '2027-11-07', 'École nationale supérieure d’art et de design de Nancy'),
    ('p7', 'Restauration Périscolaire Essey', 'Enseignement', 'In Progress', 1200000, '2025-01-01', '2026-12-02', 'Creation de Locaux de Restauration Peri-Scolaire et Annexes dans les Anciennes Ecuries du Haut-Chateau a ESSEY-LES-NANCY'),
    ('p8', 'Groupe Scolaire Ménil-la-Tour', 'Enseignement', 'Planning', 2100000, '2025-08-01', '2027-12-02', 'Solutions passives (sur isolation) ou semi passives (recuperation des apports). Capteurs solaires pour la production ECS.'),
    ('p9', 'Groupe Scolaire Marcel Leroy', 'Enseignement', 'In Progress', 1500000, '2024-01-01', '2026-12-02', 'La salle de jeux preexistante est completee a rez-de-chaussee par un bloc sanitaire, une Tisannerie, un degagement sur l''entree.'),
    ('p10', 'Groupe Scolaire Laneuveville', 'Enseignement', 'In Progress', 3000000, '2024-06-01', '2026-12-02', 'Construction d''un groupe scolaire de 9 classes: 5 classes elementaires 4 classes maternelles et d''un espace de restauration.'),
    ('p11', 'Collège Liffol-le-Grand', 'Enseignement', 'In Progress', 4000000, '2024-01-01', '2026-12-02', 'Creation de College sur site pente en frange industrielle du village sur l''entree de la Nationale de Haute-Marne dans les Vosges.'),
    ('p12', 'Collège Emile Gallé', 'Enseignement', 'In Progress', 5500000, '2024-01-01', '2026-12-02', 'College existant a reconstruire, en site occupe, en trois phases de demolition et de deux phases de construction.'),
    ('p13', 'Cité Scolaire Chopin', 'Enseignement', 'In Progress', 2800000, '2024-01-01', '2026-12-02', 'Batiment en extension sur cour en bordure du Parc Sainte Marie. Liaison a l''existant par passerelle sur 2 niveaux.'),
    ('p14', 'Amphithéâtre 700', 'Enseignement', 'In Progress', 1100000, '2024-01-01', '2026-12-02', 'Refection complete de l’etancheite avec integration d’une isolation ameliorant le bilan thermique du batiment.'),
    ('p15', 'Collège Burnhaupt', 'Enseignement', 'In Progress', 8000000, '2024-01-01', '2026-12-02', 'Construction d’un collège 600 et 4 logements de fonction.'),
    ('p16', 'Lycée Emmanuel Héré', 'Enseignement', 'Completed', 7500000, '2005-01-01', '2017-12-02', 'Demolir et a reconstruire le batiment des ateliers en fonction d’un phasage permettant le fonctionnement de l’etablissement.'),
    ('p17', 'CERMAB ENSTIB', 'Enseignement', 'Completed', 3200000, '2000-01-01', '2017-12-02', 'Le mail central de distribution en double hauteur est scande par les poteaux biais en auto contreventement.'),
    ('p18', 'IUT MCQ - CML', 'Enseignement', 'Completed', 2500000, '1998-01-01', '2017-12-02', 'Le C.M.L. Centre de Mesure Lorrain est un laboratoire de metrologie.'),
    ('p19', 'Pôle de Métiers Epinal', 'Enseignement', 'Completed', 4500000, '1999-01-01', '2017-12-02', 'Administration dans Existant sur rue restructure, Enseignement Mecanique dans Sous-Sol Existant restructure.'),
    ('p20', 'ENSTIB Epinal', 'Enseignement', 'Completed', 3800000, '1995-01-01', '2017-12-02', 'Bâtiment en Extension jouxtant sur la halle métallique préexistante.'),
    ('p21', 'Hôtel de Police Verdun', 'Equipements Publics', 'Completed', 6500000, '2008-01-01', '2018-11-05', 'Rehabilitation de deux batiments contigus en un Hotel de Police.'),
    ('p22', 'Caserne Void-Vacon', 'Equipements Publics', 'Completed', 3200000, '2010-01-01', '2018-11-05', 'Casernement de Gendarmerie.'),
    ('p23', 'Caserne Seichamps', 'Equipements Publics', 'Completed', 3500000, '2011-01-01', '2018-11-05', 'Caserne de gendarmerie à Seichamps.'),
    ('p24', 'Unité Alzheimer Arcis', 'Santé', 'Completed', 4200000, '2012-01-01', '2017-12-02', 'Construction d’une Unité dédiée à la prise en charge de personnes atteintes de la maladie d’Alzheimer.'),
    ('p25', 'Pôle Mère-Enfant Verdun', 'Santé', 'Completed', 15000000, '2010-01-01', '2017-12-02', 'Le projet doit s''inserer entre le batiment principal Saint-Nicolas et le batiment ancien Laennec.'),
    ('p26', 'Maison de Retraite Commercy', 'Santé', 'Completed', 5800000, '2009-01-01', '2018-11-07', 'Rehabilitation et liaison partielle du batiment du 18eme siecle au batiment existant.'),
    ('p27', 'Centre Psychothérapique Nancy', 'Santé', 'Completed', 3900000, '2008-01-01', '2018-11-07', 'Construction d''un centre de soins de jour a Essey les Nancy.'),
    ('p28', 'Complexe aquatique La Seyne', 'Sports', 'Completed', 12000000, '2015-01-01', '2018-11-07', 'Complexe aquatique à la Seyne-sur-Mer.'),
    ('p29', 'Halle des Sports Vandoeuvre', 'Sports', 'Completed', 8500000, '2004-01-01', '2017-12-02', 'Salle de Danse, salle de Musculation, Grande Halle pour sports collectifs.'),
    ('p30', 'Salle multisports Granges', 'Sports', 'Completed', 2200000, '2016-01-01', '2018-11-07', 'Le projet se situe en contrebas d''une colline boisee de feuillus et de resineux.'),
    ('p31', 'Palais des Sports Vandoeuvre', 'Sports', 'Completed', 4500000, '2010-01-01', '2017-12-02', 'Restructuration des vestiaires et tribunes existantes. Nouvelle tribune de 1376 places.'),
    ('p32', 'Salle Gymnastique Vandoeuvre', 'Sports', 'Completed', 3200000, '2008-01-01', '2017-12-02', 'La pente du terrain est exploitee par une organisation en un rez-de-chaussee haut et bas.'),
    ('p33', 'EAESL Acacias Terville', 'Sports', 'Completed', 1800000, '2014-01-01', '2018-11-07', 'Accueil et vestiaires des joueurs et arbitres pour le terrain de football.'),
    ('p34', 'Salle multisports Toul', 'Sports', 'Completed', 2900000, '2012-01-01', '2017-12-02', 'Construction d’un gymnase comprenant une salle de gymnastique et une salle de musculation.'),
    ('p35', 'Musée Lorrain', 'Socioculturel', 'Completed', 18000000, '2013-01-01', '2017-12-02', 'Restructuration et Extension du Musée Lorrain.'),
    ('p36', 'Maison des Lacs', 'Socioculturel', 'Completed', 2500000, '2014-01-01', '2018-11-07', 'Maison des lacs et sentiers d''interpretation de Pierre-Percée.'),
    ('p37', 'Complexe Dommartin-les-Toul', 'Socioculturel', 'Completed', 3100000, '2010-01-01', '2017-12-02', 'Complexe Sportif Associatif Municipal.'),
    ('p38', 'Zénith de Nancy', 'Socioculturel', 'Completed', 25000000, '2005-01-01', '2017-12-02', 'Salles de spectacles 6000 pers et annexes, amphitheatre plein air 25000 pers.'),
    ('p39', 'Théâtre Mobile', 'Socioculturel', 'Completed', 1500000, '2008-01-01', '2017-12-02', 'Theatre mobile demontable peut acceuillir un effectif de 264 personnes assises en gradins.'),
    ('p40', 'Salle des Fêtes Raon', 'Socioculturel', 'Completed', 2100000, '2009-01-01', '2017-12-02', 'Insertion intersticielle tres tendue dans le tissu urbain.'),
    ('p41', 'Salle François Truffaut', 'Socioculturel', 'Completed', 1800000, '2011-01-01', '2017-12-02', 'Salle multimedia accueillant theatre, musique, video, cinema.'),
    ('p42', 'Musée Commercy', 'Socioculturel', 'Completed', 2400000, '2010-01-01', '2017-12-02', 'Musee des Ivoires et Faiences dans les anciens Bains Douches municipaux.'),
    ('p43', 'Salle Saint-Max', 'Socioculturel', 'Completed', 3500000, '2012-01-01', '2017-12-02', 'Salle Socio-Culturelle en plein centre ville.'),
    ('p44', 'Complexe Ludres', 'Socioculturel', 'Completed', 4200000, '2013-01-01', '2017-12-02', 'Complexe Multifonctions.'),
    ('p45', 'Maison des Associations Essey', 'Socioculturel', 'Completed', 2800000, '2014-01-01', '2017-12-02', 'Construction neuve Essey les Nancy.'),
    ('p46', 'CCI Meurthe-et-Moselle', 'Tertiaire', 'Completed', 5500000, '2015-01-01', '2017-12-02', 'Restructuration du Siège de la Chambre de Commerce et d''Industrie.'),
    ('p47', 'Laboratoire Vétérinaire Epinal', 'Tertiaire', 'Completed', 3800000, '2011-01-01', '2017-12-02', 'Laboratoires d’analyses, annexes techniques.'),
    ('p48', 'Agence de l''Eau Metz', 'Tertiaire', 'Completed', 4100000, '2012-01-01', '2017-12-02', 'Batiment de bureaux archives et salle du conseil.'),
    ('p49', 'France Telecom Thionville', 'Tertiaire', 'Completed', 2900000, '2010-01-01', '2017-12-02', 'Agence commerciale France Telecom.'),
    ('p50', 'DDE Champigneulles', 'Tertiaire', 'Completed', 3600000, '2009-01-01', '2017-12-02', 'Regroupement des Services de la DDE et Centre Commandement.'),
    ('p51', 'Bureaux Rue Lyautey', 'Tertiaire', 'Completed', 1500000, '2008-01-01', '2017-12-02', 'Reamenagement en deux phases de l''immeuble de bureaux.'),
    ('p52', 'PRABIL', 'Tertiaire', 'Completed', 4800000, '2013-01-01', '2017-12-02', 'Plate Forme Agro-Bio-Industrielle de Lorraine.'),
    ('p53', 'Biopark Archamps', 'Tertiaire', 'Completed', 5200000, '2014-01-01', '2017-12-02', 'Animaleries, plateforme technique, laboratoires de recherche.'),
    ('p54', 'Asagi Behonne', 'Tertiaire', 'Completed', 1200000, '2015-01-01', '2017-12-02', 'Siege d''ASAGI, importateur de poissons.'),
    ('p55', '36 Logements Villerupt', 'Logements', 'Completed', 4500000, '2011-01-01', '2017-12-02', '36 Logements BBC à Villerupt.'),
    ('p56', '40 Logements Nancy', 'Logements', 'Completed', 5100000, '2012-01-01', '2017-12-02', '40 Logements THPE à Nancy - Meurthe Canal.'),
    ('p57', '111 Logements Villers', 'Logements', 'Completed', 12500000, '2006-01-01', '2017-12-02', '111 Logements HQE à Villers les Nancy.'),
    ('p58', 'La Poste PCIN Lorraine', 'Industriel', 'Completed', 8500000, '2008-01-01', '2017-12-02', 'Plate-forme Colis Industrielle.'),
    ('p59', 'STAC Verdun', 'Industriel', 'Completed', 3200000, '2009-01-01', '2017-12-02', 'Stockage des Archives Nationales Comptables de la Poste.'),
    ('p60', 'EquipEst Maxéville', 'Industriel', 'Completed', 2800000, '2010-01-01', '2017-12-02', 'Reconstruction des locaux Equip Est.'),
    ('p61', 'Parvis Foch Jarville', 'Urbanisme', 'Completed', 1500000, '2011-01-01', '2018-11-07', 'Aménagement du Parvis Urbain Foch-Renémont.'),
    ('p62', 'Parvis Piscine Maizières', 'Urbanisme', 'Completed', 800000, '2012-01-01', '2018-11-07', 'Revalorisation du Parvis de la Piscine.'),
    ('p63', 'Friche Didier Longwy', 'Urbanisme', 'Completed', 6500000, '2013-01-01', '2018-11-07', 'Aménagement de la Friche Didier à Longwy/Réhon.'),
    ('p64', 'Bazancourt', 'Urbanisme', 'Completed', 4200000, '2014-01-01', '2017-12-02', '16 Logements-Mediatheque-Tertiaire.'),
    ('p65', 'Pont Mobile Bazin', 'Urbanisme', 'Completed', 2100000, '2015-01-01', '2017-12-02', 'Structure metallique de franchissement du canal de la Marne au Rhin.'),
    ('p66', 'Place Reggio Bar-le-Duc', 'Urbanisme', 'Completed', 1800000, '2016-01-01', '2017-12-02', 'Esplanade, parking, jardins, banc fontaine, kiosque.'),
    ('p67', 'Etude Thionville', 'Urbanisme', 'Completed', 500000, '2017-01-01', '2017-12-02', 'Reconquete urbaine rive droite de la Moselle a Thionville.');

    INSERT OR IGNORE INTO team_members (id, name, role, email, avatar, system_role) VALUES 
    ('t1', 'Alexandre Chemetoff', 'Architecte Associé', 'a.chemetoff@aacz.fr', 'https://picsum.photos/seed/alex/200', 'admin'),
    ('t2', 'Marc Zylber', 'Architecte Associé', 'm.zylber@aacz.fr', 'https://picsum.photos/seed/marc/200', 'pm'),
    ('t3', 'Sarah Chen', 'Ingénieure Structure', 's.chen@aacz.fr', 'https://picsum.photos/seed/sarah/200', 'user'),
    ('t4', 'Julie Martin', 'Architecte d''Intérieur', 'j.martin@aacz.fr', 'https://picsum.photos/seed/julie/200', 'user');

    INSERT OR IGNORE INTO milestones (id, project_id, title, due_date, completed) VALUES 
    ('m1', 'p1', 'Livraison', '2018-08-15', 1),
    ('m2', 'p2', 'Réception des travaux', '2018-11-20', 1),
    ('m3', 'p4', 'Inauguration', '2026-09-15', 0),
    ('m4', 'p3', 'Fin de gros oeuvre', '2026-04-15', 0),
    ('m5', 'p6', 'Pose des menuiseries', '2026-05-10', 0),
    ('m6', 'p10', 'Réception lot 1', '2026-04-20', 0);

    INSERT OR IGNORE INTO tenders (id, title, client, submission_deadline, status, value, notes) VALUES 
    ('ten1', 'Médiathèque de Thionville', 'Ville de Thionville', '2026-06-15', 'Draft', 4500000, 'Concours sur esquisse.'),
    ('ten2', 'Gymnase de Lunéville', 'Région Grand Est', '2026-05-30', 'Submitted', 3200000, 'Réhabilitation thermique et extension.');

    INSERT OR IGNORE INTO specifications (id, project_id, title, content, last_updated) VALUES 
    ('s1', 'p1', 'CCTP Lot Gros Œuvre', '[{"id":"sec1","title":"Terrassements","items":[{"id":"i1","code":"02.10","description":"Décapage de la terre végétale","material":"N/A","notes":"Stockage sur site"}]}]', '2016-02-21T10:00:00Z');
  `);

  // Update existing members with roles if they were already in the DB
  db.prepare("UPDATE team_members SET system_role = 'admin' WHERE id = 't1'").run();
  db.prepare("UPDATE team_members SET system_role = 'pm' WHERE id = 't2'").run();
  db.prepare("UPDATE team_members SET system_role = 'user' WHERE id IN ('t3', 't4')").run();
} catch (error) {
  console.error("Failed to initialize database:", error);
}

async function startServer() {
  const app = express();
  app.use('/uploads', express.static(uploadDir));
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.get("/api/rnb-buildings", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }
      
      const url = `https://rnb-api.beta.gouv.fr/api/alpha/buildings/address/?q=${encodeURIComponent(q as string)}`;
      console.log(`Calling RNB API: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`RNB API error: ${response.status} ${errorText}`);
        return res.status(response.status).json({ error: `RNB API error: ${response.status}`, details: errorText });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error in /api/rnb-buildings:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/georisques", async (req, res) => {
    try {
      const { latitude, longitude, code_insee } = req.query;
      console.log(`Georisques API request: latitude=${latitude}, longitude=${longitude}, code_insee=${code_insee}`);
      if (!latitude || !longitude || !code_insee) {
        console.error("Missing required parameters for Georisques API");
        return res.status(400).json({ error: "latitude, longitude, and code_insee are required" });
      }

      const token = process.env.GEORISQUES_API_TOKEN;
      console.log(`Georisques API token present: ${!!token}`);
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MyApplication/1.0)'
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const url = `https://www.georisques.gouv.fr/api/v1/gaspar/risques?latitude=${latitude}&longitude=${longitude}&code_insee=${code_insee}&type=adresse`;
      console.log(`Calling Georisques API: ${url}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Georisques API error: ${response.status} ${errorText}`);
        return res.status(response.status).json({ error: `Georisques API error: ${response.status}`, details: errorText });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error in /api/georisques:", error);
      if (error.name === 'AbortError') {
        res.status(504).json({ error: "Georisques API request timed out" });
      } else {
        res.status(500).json({ error: "Internal server error", details: error.message });
      }
    }
  });

  // Étape 0 : géocoder une adresse via le géocodeur interne BDNB pour obtenir la cle_interop_adr
  app.get("/api/bdnb-geocode", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const url = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=5`;
      console.log(`Calling BDNB Geocodage API: ${url}`);

      const response = await fetchWithTimeout(url, {
        headers: { 'Accept': 'application/json' }
      }, 10000); // 10 second timeout

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response body');
        console.error(`BDNB Geocodage error: ${response.status} ${errorText.substring(0, 200)}`);
        return res.status(response.status).json({ error: `BDNB Geocodage error: ${response.status}`, details: errorText.substring(0, 200) });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text().catch(() => 'Could not read body');
        console.error(`BDNB Geocodage returned non-JSON: ${text.substring(0, 200)}`);
        res.status(502).json({ error: "Invalid response from BDNB Geocodage", details: text.substring(0, 200) });
      }
    } catch (error: any) {
      console.error("Error in /api/bdnb-geocode:", error);
      if (error.name === 'AbortError') {
        res.status(504).json({ error: "BDNB geocodage request timed out" });
      } else {
        res.status(500).json({ error: "Internal server error", details: error.message });
      }
    }
  });

  app.get("/api/bdnb", async (req, res) => {
    try {
      const { q, banId, cityCode } = req.query;
      if (!q && !banId) {
        return res.status(400).json({ error: "Query parameter 'q' or 'banId' is required" });
      }
      
      let buildings: any[] = [];
      
      // Step 1: If we have a banId, try to find the building group ID first using the relationship table
      // This table is indexed on cle_interop_adr and is much faster for direct lookups
      if (banId) {
        const relUrl = `https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse?cle_interop_adr=eq.${banId}&select=batiment_groupe_id`;
        console.log(`Calling BDNB Rel API: ${relUrl}`);
        
        try {
          const relResponse = await fetchWithTimeout(relUrl, {
            headers: { 'Accept': 'application/json' }
          }, 5000); // 5 second timeout
          
          if (relResponse.ok) {
            const relData = await relResponse.json();
            const ids = relData.map((item: any) => item.batiment_groupe_id).filter(Boolean);
            
            if (ids.length > 0) {
              // Step 2: Fetch full details for these specific building IDs
              const detailUrl = `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?batiment_groupe_id=in.(${ids.join(',')})&limit=5`;
              console.log(`Calling BDNB Detail API: ${detailUrl}`);
              
              const detailResponse = await fetchWithTimeout(detailUrl, {
                headers: { 'Accept': 'application/json' }
              }, 5000);
              
              if (detailResponse.ok) {
                buildings = await detailResponse.json();
              }
            }
          }
        } catch (err) {
          console.error("Error in BDNB direct lookup:", err);
          // Continue to fallback if direct lookup fails
        }
      }
      
      // Step 3: Fallback to geocoder if no buildings found via banId or no banId provided
      // Fuzzy search on batiment_groupe_complet is very slow. 
      // We use the geocoder to get a cle_interop_adr first.
      if (buildings.length === 0 && q) {
        console.log(`[BDNB] Fallback: Geocoding query "${q}" to get cle_interop_adr`);
        const geoUrl = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=1`;
        
        try {
          const geoRes = await fetchWithTimeout(geoUrl, {
            headers: { 'Accept': 'application/json' }
          }, 5000);
          
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const firstResult = geoData[0];
            if (firstResult && firstResult.cle_interop_adr) {
              const banIdFromGeo = firstResult.cle_interop_adr;
              console.log(`[BDNB] Geocoder found cle_interop_adr: ${banIdFromGeo}`);
              
              // Now try direct lookup with this ID
              const relUrl = `https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse?cle_interop_adr=eq.${banIdFromGeo}&select=batiment_groupe_id`;
              const relResponse = await fetchWithTimeout(relUrl, {
                headers: { 'Accept': 'application/json' }
              }, 5000);
              
              if (relResponse.ok) {
                const relData = await relResponse.json();
                const ids = relData.map((item: any) => item.batiment_groupe_id).filter(Boolean);
                
                if (ids.length > 0) {
                  const detailUrl = `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?batiment_groupe_id=in.(${ids.join(',')})&limit=5`;
                  const detailResponse = await fetchWithTimeout(detailUrl, {
                    headers: { 'Accept': 'application/json' }
                  }, 5000);
                  
                  if (detailResponse.ok) {
                    buildings = await detailResponse.json();
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("Error in BDNB fallback geocoding:", err);
        }
      }
      
      // Step 4: Final fallback to fuzzy search ONLY if geocoder failed or returned nothing
      // This is the last resort and might still timeout.
      if (buildings.length === 0 && q) {
        let url = `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?limit=5`;
        if (cityCode) {
          url += `&code_commune_insee=eq.${cityCode}`;
        }
        url += `&libelle_adr_principale_ban=ilike.*${encodeURIComponent(q as string)}*`;
        
        console.log(`Calling BDNB Final Fallback API: ${url}`);
        
        try {
          const response = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/json' }
          }, 15000); // Increased timeout for fuzzy search
          
          if (response.ok) {
            buildings = await response.json();
          }
        } catch (err) {
          console.error("Error in BDNB final fallback search:", err);
        }
      }
      
      res.json(buildings);
    } catch (error: any) {
      console.error("Error in /api/bdnb:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });

  // OS Routes
  app.get("/api/ordres_de_service", (req, res) => {
    try {
      const { project_id } = req.query;
      const os = db.prepare("SELECT * FROM ordres_de_service WHERE project_id = ?").all(project_id);
      res.json(os);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch OS" });
    }
  });

  app.post("/api/ordres_de_service", (req, res) => {
    try {
      console.log("Received POST request for OS. req.body:", req.body);
      const { 
        project_id, os_number, march_number, title, date, description, lot, status,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      } = req.body || {};
      const id = `os-${Date.now()}`;
      db.prepare(`
        INSERT INTO ordres_de_service (
          id, project_id, os_number, march_number, title, date, description, lot, status,
          maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
          date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
          incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, project_id, os_number, march_number, title, date, description, lot, status || 'draft',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      );
      console.log("OS created successfully with ID:", id);
      res.status(201).json({ id });
    } catch (error) {
      console.error("Error creating OS:", error);
      res.status(500).json({ error: "Failed to create OS", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/ordres_de_service/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { 
        os_number, march_number, title, date, description, lot, status,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      } = req.body;
      db.prepare(`
        UPDATE ordres_de_service
        SET os_number = ?, march_number = ?, title = ?, date = ?, description = ?, lot = ?, status = ?,
            maitrise_oeuvre_adresse = ?, entreprise = ?, origine_demande = ?, montant_marche_ht = ?, objet = ?,
            date_fourniture = ?, article_ccap = ?, incidences_delais_type = ?, incidences_delais_details = ?,
            incidences_couts_type = ?, montant_devis_presente = ?, montant_devis_accepte = ?, date_signature = ?
        WHERE id = ?
      `).run(
        os_number, march_number, title, date, description, lot, status,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature, id
      );
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update OS" });
    }
  });

  app.delete("/api/ordres_de_service/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM ordres_de_service WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete OS" });
    }
  });

  // Visa Routes
  app.get("/api/visas", (req, res) => {
    try {
      const { project_id } = req.query;
      const visas = db.prepare("SELECT * FROM visas WHERE project_id = ?").all(project_id);
      res.json(visas);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch visas" });
    }
  });

  app.post("/api/visas", (req, res) => {
    try {
      const { project_id, title, date, status, comments, document_url } = req.body;
      const id = `visa-${Date.now()}`;
      db.prepare("INSERT INTO visas (id, project_id, title, date, status, comments, document_url) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id, project_id, title, date, status || 'pending', comments, document_url
      );
      const visa = db.prepare("SELECT * FROM visas WHERE id = ?").get(id);
      res.json(visa);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create visa" });
    }
  });

  app.delete("/api/visas/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM visas WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete visa" });
    }
  });

  // Reception Routes
  app.get("/api/receptions", (req, res) => {
    try {
      const { project_id } = req.query;
      const receptions = db.prepare("SELECT * FROM receptions WHERE project_id = ?").all(project_id);
      res.json(receptions);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch receptions" });
    }
  });

  app.post("/api/receptions", (req, res) => {
    try {
      const { project_id, date, type, has_reserves, reserves_count, document_url } = req.body;
      const id = `rec-${Date.now()}`;
      db.prepare("INSERT INTO receptions (id, project_id, date, type, has_reserves, reserves_count, document_url) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id, project_id, date, type, has_reserves ? 1 : 0, reserves_count || 0, document_url
      );
      const reception = db.prepare("SELECT * FROM receptions WHERE id = ?").get(id);
      res.json(reception);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create reception" });
    }
  });

  app.delete("/api/receptions/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM receptions WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete reception" });
    }
  });

  // Reserves
  app.get("/api/reserves", (req, res) => {
    try {
      const { project_id } = req.query;
      const reserves = db.prepare("SELECT * FROM reserves WHERE project_id = ?").all(project_id);
      res.json(reserves);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch reserves" });
    }
  });

  app.post("/api/reserves", (req, res) => {
    try {
      const { id, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
      
      // Get the next number for this project
      const lastReserve = db.prepare("SELECT MAX(number) as max_num FROM reserves WHERE project_id = ?").get(project_id) as { max_num: number | null };
      const nextNumber = (lastReserve?.max_num || 0) + 1;

      db.prepare(`
        INSERT INTO reserves (id, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, project_id, reception_id, title, batiment, local, status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, nextNumber);
      
      res.json({ id, project_id, reception_id, title, batiment, local, status: status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, number: nextNumber });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create reserve" });
    }
  });

  app.delete("/api/reserves/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM reserves WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete reserve" });
    }
  });

  app.put("/api/reserves/:id", (req, res) => {
    try {
      const { title, batiment, local, status, lots, entreprises, created_at, due_date } = req.body;
      db.prepare(`
        UPDATE reserves 
        SET title = ?, batiment = ?, local = ?, status = ?, lots = ?, entreprises = ?, created_at = ?, due_date = ?
        WHERE id = ?
      `).run(title, batiment, local, status, lots, entreprises, created_at, due_date, req.params.id);
      res.json({ id: req.params.id, title, batiment, local, status, lots, entreprises, created_at, due_date });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update reserve" });
    }
  });

  // Plans
  app.get("/api/plans", (req, res) => {
    try {
      const { project_id } = req.query;
      const plans = db.prepare("SELECT * FROM plans WHERE project_id = ?").all(project_id);
      res.json(plans);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch plans" });
    }
  });

  app.post("/api/plans", (req, res) => {
    try {
      const { id, project_id, name, file_url } = req.body;
      db.prepare("INSERT INTO plans (id, project_id, name, file_url, uploaded_at) VALUES (?, ?, ?, ?, ?)").run(id, project_id, name, file_url, new Date().toISOString());
      res.json({ id, project_id, name, file_url, uploaded_at: new Date().toISOString() });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create plan" });
    }
  });

  // Document Routes
  app.get("/api/documents", (req, res) => {
    try {
      const { project_id } = req.query;
      const docs = db.prepare("SELECT * FROM documents WHERE project_id = ?").all(project_id);
      res.json(docs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/documents", upload.single('file'), (req, res) => {
    try {
      const { project_id, name, category, description, uploaded_by } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const id = `doc-${Date.now()}`;
      const file_url = `/uploads/${file.filename}`;
      
      db.prepare(`
        INSERT INTO documents (id, project_id, name, category, version, file_url, uploaded_by, uploaded_at, description)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(id, project_id, name, category, 1, file_url, uploaded_by, new Date().toISOString(), description);

      db.prepare(`
        INSERT INTO document_versions (id, document_id, version, file_url, uploaded_by, uploaded_at, description)
        VALUES (?, ?, 1, ?, ?, ?, ?)
      `).run(`ver-${Date.now()}`, id, file_url, uploaded_by, new Date().toISOString(), description);

      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  app.get("/api/documents/:id/versions", (req, res) => {
    try {
      const { id } = req.params;
      const versions = db.prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC").all(id);
      res.json(versions);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch document versions" });
    }
  });

  app.get("/api/projects", (req, res) => {
    try {
      const projects = db.prepare("SELECT * FROM projects").all();
      
      const projectsWithDetails = projects.map((project: any) => {
        const cotraitants = db.prepare(`
          SELECT pc.*, c.first_name || ' ' || c.last_name as contact_name
          FROM project_cotraitants pc
          LEFT JOIN contacts c ON pc.contact_id = c.id
          WHERE pc.project_id = ?
        `).all(project.id);

        const lots = db.prepare(`
          SELECT pl.*, c.first_name || ' ' || c.last_name as contact_name
          FROM project_lots pl
          LEFT JOIN contacts c ON pl.contact_id = c.id
          WHERE pl.project_id = ?
        `).all(project.id);

        const stakeholders = db.prepare(`
          SELECT ps.*, c.first_name || ' ' || c.last_name as contact_name
          FROM project_stakeholders ps
          LEFT JOIN contacts c ON ps.contact_id = c.id
          WHERE ps.project_id = ?
        `).all(project.id);

        const categories = db.prepare(`
          SELECT pc.*
          FROM project_categories pc
          JOIN project_categories_junction pcj ON pc.id = pcj.category_id
          WHERE pcj.project_id = ?
        `).all(project.id);

        return { ...project, cotraitants_list: cotraitants, lots_list: lots, stakeholders_list: stakeholders, categories_list: categories };
      });
      
      res.json(projectsWithDetails);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id/full", (req, res) => {
    try {
      const { id } = req.params;
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const milestones = db.prepare("SELECT * FROM milestones WHERE project_id = ?").all(id);
      const invoices = db.prepare("SELECT * FROM invoices WHERE project_id = ?").all(id);
      const specifications = db.prepare("SELECT * FROM specifications WHERE project_id = ?").all(id);
      const ordres_de_service = db.prepare("SELECT * FROM ordres_de_service WHERE project_id = ?").all(id);
      const visas = db.prepare("SELECT * FROM visas WHERE project_id = ?").all(id);
      const receptions = db.prepare("SELECT * FROM receptions WHERE project_id = ?").all(id);
      const reserves = db.prepare("SELECT * FROM reserves WHERE project_id = ?").all(id);
      const plans = db.prepare("SELECT * FROM plans WHERE project_id = ?").all(id);

      res.json({
        project,
        milestones,
        invoices,
        specifications,
        ordres_de_service,
        visas,
        receptions,
        reserves,
        plans
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch project details" });
    }
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Situations API
  app.get("/api/dpgf/:projectId", (req, res) => {
    try {
      const items = db.prepare("SELECT * FROM dpgf_items WHERE project_id = ?").all(req.params.projectId);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch dpgf items" });
    }
  });

  app.get("/api/situations/:projectId", (req, res) => {
    try {
      const situations = db.prepare("SELECT * FROM situations WHERE project_id = ?").all(req.params.projectId);
      res.json(situations);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch situations" });
    }
  });

  app.get("/api/situations/:situationId/details", (req, res) => {
    try {
      const details = db.prepare("SELECT * FROM detail_situations WHERE situation_id = ?").all(req.params.situationId);
      res.json(details);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch situation details" });
    }
  });

  app.post("/api/projects", (req, res) => {
    try {
      const { 
        id, name, client, status, budget, category, start_date, end_date, description, image_url, address, 
        is_complete_mission, etudes_notes, chantier_notes, is_public_client,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list
      } = req.body;
      
      if (!name || !client) {
        return res.status(400).json({ error: "Name and client are required" });
      }

      // Generate project code: YYNNN
      const year = new Date().getFullYear().toString().slice(-2);
      const count = db.prepare("SELECT COUNT(*) as count FROM projects WHERE project_code LIKE ?").get(`${year}%`) as { count: number };
      const nextNum = (count.count + 1).toString().padStart(3, '0');
      const project_code = `${year}${nextNum}`;

      const insertProject = db.transaction(() => {
        db.prepare(`
          INSERT INTO projects (
            id, name, client, status, budget, category, start_date, end_date, description, image_url, project_code, address, 
            is_complete_mission, etudes_notes, chantier_notes, is_public_client,
            surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises
          ) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, 
          name, 
          client, 
          status || 'Planning', 
          budget || 0, 
          category || null, 
          start_date || new Date().toISOString().split('T')[0], 
          end_date || new Date().toISOString().split('T')[0], 
          description || null, 
          image_url || null, 
          project_code,
          address || null,
          is_complete_mission ? 1 : 0,
          etudes_notes || null,
          chantier_notes || null,
          is_public_client ? 1 : 0,
          surface || null,
          construction_cost || null,
          remuneration || null,
          progression || null,
          project_manager || null,
          cotraitants || null,
          external_intervenants || null,
          entreprises || null
        );

        if (cotraitants_list && Array.isArray(cotraitants_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_cotraitants (id, project_id, specialty, contact_id)
            VALUES (?, ?, ?, ?)
          `);
          for (const cot of cotraitants_list) {
            stmt.run(`pc${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, cot.specialty, cot.contact_id || null);
          }
        }

        if (lots_list && Array.isArray(lots_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_lots (id, project_id, lot_number, lot_title, contact_id)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const lot of lots_list) {
            stmt.run(`pl${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, lot.lot_number, lot.lot_title, lot.contact_id || null);
          }
        }

        if (stakeholders_list && Array.isArray(stakeholders_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_stakeholders (id, project_id, name, role, contact_id)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const s of stakeholders_list) {
            stmt.run(`ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, s.name, s.role, s.contact_id || null);
          }
        }

        if (categories_list && Array.isArray(categories_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_categories_junction (project_id, category_id)
            VALUES (?, ?)
          `);
          for (const catId of categories_list) {
            stmt.run(id, catId);
          }
        }
      });

      insertProject();
      
      res.status(201).json({ id, project_code });
    } catch (error: any) {
      console.error("Error creating project:", error);
      res.status(500).json({ error: "Failed to create project: " + error.message });
    }
  });

  app.put("/api/projects/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { 
        name, client, status, budget, category, start_date, end_date, description, image_url, address, 
        is_complete_mission, etudes_notes, chantier_notes, is_public_client,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list
      } = req.body;
      
      if (!name || !client) {
        return res.status(400).json({ error: "Name and client are required" });
      }

      const updateContactAffaires = (contactId: string, projectId: string) => {
        const contact = db.prepare("SELECT affaires FROM contacts WHERE id = ?").get(contactId);
        if (!contact) return;
        
        let affaires = contact.affaires ? contact.affaires.split(',').map((s: string) => s.trim()) : [];
        if (!affaires.includes(projectId)) {
          affaires.push(projectId);
          db.prepare("UPDATE contacts SET affaires = ? WHERE id = ?").run(affaires.join(','), contactId);
        }
      };

      const updateProject = db.transaction(() => {
        const result = db.prepare(`
          UPDATE projects 
          SET name = ?, client = ?, status = ?, budget = ?, category = ?, start_date = ?, end_date = ?, description = ?, image_url = ?, address = ?, 
              is_complete_mission = ?, etudes_notes = ?, chantier_notes = ?, is_public_client = ?,
              surface = ?, construction_cost = ?, remuneration = ?, progression = ?, project_manager = ?, cotraitants = ?, external_intervenants = ?, entreprises = ?
          WHERE id = ?
        `).run(
          name, 
          client, 
          status, 
          budget, 
          category || null, 
          start_date, 
          end_date, 
          description || null, 
          image_url || null, 
          address || null,
          is_complete_mission ? 1 : 0,
          etudes_notes || null,
          chantier_notes || null,
          is_public_client ? 1 : 0,
          surface || null,
          construction_cost || null,
          remuneration || null,
          progression || null,
          project_manager || null,
          cotraitants || null,
          external_intervenants || null,
          entreprises || null,
          id
        );

        if (result.changes === 0) {
          throw new Error("Project not found");
        }

        // Update cotraitants
        db.prepare("DELETE FROM project_cotraitants WHERE project_id = ?").run(id);
        if (cotraitants_list && Array.isArray(cotraitants_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_cotraitants (id, project_id, specialty, contact_id)
            VALUES (?, ?, ?, ?)
          `);
          for (const cot of cotraitants_list) {
            stmt.run(`pc${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, cot.specialty, cot.contact_id || null);
            if (cot.contact_id) updateContactAffaires(cot.contact_id, id);
          }
        }

        // Update lots
        db.prepare("DELETE FROM project_lots WHERE project_id = ?").run(id);
        if (lots_list && Array.isArray(lots_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_lots (id, project_id, lot_number, lot_title, contact_id)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const lot of lots_list) {
            stmt.run(`pl${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, lot.lot_number, lot.lot_title, lot.contact_id || null);
            if (lot.contact_id) updateContactAffaires(lot.contact_id, id);
          }
        }

        db.prepare("DELETE FROM project_stakeholders WHERE project_id = ?").run(id);
        if (stakeholders_list && Array.isArray(stakeholders_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_stakeholders (id, project_id, name, role, contact_id)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const s of stakeholders_list) {
            stmt.run(`ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, s.name, s.role, s.contact_id || null);
            if (s.contact_id) updateContactAffaires(s.contact_id, id);
          }
        }

        db.prepare("DELETE FROM project_categories_junction WHERE project_id = ?").run(id);
        if (categories_list && Array.isArray(categories_list)) {
          const stmt = db.prepare(`
            INSERT INTO project_categories_junction (project_id, category_id)
            VALUES (?, ?)
          `);
          for (const catId of categories_list) {
            stmt.run(id, catId);
          }
        }
      });

      updateProject();
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating project:", error);
      res.status(error.message === "Project not found" ? 404 : 500).json({ error: "Failed to update project: " + error.message });
    }
  });

  app.delete("/api/projects/:id", (req, res) => {
    try {
      const { id } = req.params;
      const userRole = req.headers['x-user-role'];
      
      console.log(`Attempting to delete project ${id} with role ${userRole}`);

      if (userRole !== 'admin') {
        console.log(`Access denied for role ${userRole}`);
        return res.status(403).json({ error: "Only administrators can delete projects" });
      }

      // Start a transaction to ensure all related data is deleted
      const deleteProject = db.transaction((projectId) => {
        const t1 = db.prepare("DELETE FROM project_team WHERE project_id = ?").run(projectId);
        const t2 = db.prepare("DELETE FROM milestones WHERE project_id = ?").run(projectId);
        const t3 = db.prepare("DELETE FROM specifications WHERE project_id = ?").run(projectId);
        const t4 = db.prepare("DELETE FROM project_cotraitants WHERE project_id = ?").run(projectId);
        const t5 = db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
        console.log(`Deleted: ${t1.changes} team links, ${t2.changes} milestones, ${t3.changes} specs, ${t4.changes} cotraitants, ${t5.changes} projects`);
        return t5;
      });

      const result = deleteProject(id);
      
      if (result.changes === 0) {
        console.log(`Project ${id} not found`);
        return res.status(404).json({ error: "Project not found" });
      }
      console.log(`Project ${id} deleted successfully`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project: " + error.message });
    }
  });

  app.get("/api/project_categories", (req, res) => {
    try {
      const categories = db.prepare("SELECT * FROM project_categories ORDER BY name").all();
      res.json(categories);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch project categories" });
    }
  });

  app.post("/api/project_categories", (req, res) => {
    try {
      const { id, name } = req.body;
      db.prepare("INSERT INTO project_categories (id, name) VALUES (?, ?)").run(id, name);
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create project category" });
    }
  });

  app.delete("/api/project_categories/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM project_categories WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete project category" });
    }
  });

  app.get("/api/tasks", (req, res) => {
    try {
      const tasks = db.prepare("SELECT * FROM tasks").all();
      const tasksWithParsedDeps = tasks.map((task: any) => {
        let dependencies = [];
        try {
          dependencies = task.dependencies ? JSON.parse(task.dependencies) : [];
        } catch (e) {
          console.error(`Failed to parse dependencies for task ${task.id}:`, task.dependencies);
        }
        return {
          ...task,
          dependencies
        };
      });
      res.json(tasksWithParsedDeps);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", (req, res) => {
    try {
      const { id, project_id, title, start_date, end_date, progress, dependencies } = req.body;
      db.prepare("INSERT INTO tasks (id, project_id, title, start_date, end_date, progress, dependencies) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, project_id, title, start_date, end_date, progress || 0, JSON.stringify(dependencies || []));
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.put("/api/tasks/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { title, start_date, end_date, progress, dependencies } = req.body;
      db.prepare("UPDATE tasks SET title = ?, start_date = ?, end_date = ?, progress = ?, dependencies = ? WHERE id = ?")
        .run(title, start_date, end_date, progress, JSON.stringify(dependencies || []), id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.get("/api/team", (req, res) => {
    try {
      const team = db.prepare("SELECT * FROM team_members").all();
      res.json(team);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.put("/api/team/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { senderOption, defaultEmailTemplate } = req.body;
      db.prepare("UPDATE team_members SET senderOption = ?, defaultEmailTemplate = ? WHERE id = ?").run(senderOption, defaultEmailTemplate, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating team member:", error);
      res.status(500).json({ error: "Failed to update team member: " + error.message });
    }
  });

  app.get("/api/tenders", (req, res) => {
    try {
      const tenders = db.prepare(`
        SELECT t.*, c.first_name || ' ' || c.last_name as mandataire_name 
        FROM tenders t
        LEFT JOIN contacts c ON t.mandataire_id = c.id
      `).all();
      
      const tendersWithSpecialties = tenders.map((tender: any) => {
        const specialties = db.prepare(`
          SELECT ts.*, c.first_name || ' ' || c.last_name as contact_name
          FROM tender_specialties ts
          LEFT JOIN contacts c ON ts.contact_id = c.id
          WHERE ts.tender_id = ?
        `).all(tender.id);
        return { ...tender, specialties_list: specialties };
      });
      
      res.json(tendersWithSpecialties);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tenders" });
    }
  });

  app.post("/api/tenders", (req, res) => {
    try {
      const { 
        title, client, submission_deadline, status, value, notes,
        mandataire_id, type, surface, construction_cost, honoraires_percent,
        mandatory_visit, visit_date, withdrawal_deadline, specialties_list, milestones_list
      } = req.body;
      
      const id = `t${Date.now()}`;
      
      const insertTender = db.transaction(() => {
        db.prepare(`
          INSERT INTO tenders (
            id, title, client, submission_deadline, status, value, notes,
            mandataire_id, type, surface, construction_cost, honoraires_percent,
            mandatory_visit, visit_date, withdrawal_deadline
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, title, client, submission_deadline, status || 'Draft', value || 0, notes || '',
          mandataire_id || null, type || null, surface || 0, construction_cost || 0, honoraires_percent || 0,
          mandatory_visit ? 1 : 0, visit_date || null, withdrawal_deadline || null
        );

        if (specialties_list && Array.isArray(specialties_list)) {
          const stmt = db.prepare(`
            INSERT INTO tender_specialties (id, tender_id, specialty_name, contact_id)
            VALUES (?, ?, ?, ?)
          `);
          for (const spec of specialties_list) {
            stmt.run(`ts${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, spec.specialty_name, spec.contact_id || null);
          }
        }

        if (milestones_list && Array.isArray(milestones_list)) {
          const stmt = db.prepare(`
            INSERT INTO milestones (id, tender_id, title, due_date, completed)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const m of milestones_list) {
            stmt.run(`m${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, m.title, m.due_date, m.completed ? 1 : 0);
          }
        }
      });

      insertTender();
      
      // Fetch the created tender with joined data
      const tender = db.prepare(`
        SELECT t.*, c.first_name || ' ' || c.last_name as mandataire_name 
        FROM tenders t
        LEFT JOIN contacts c ON t.mandataire_id = c.id
        WHERE t.id = ?
      `).get(id);
      
      const specialties = db.prepare(`
        SELECT ts.*, c.first_name || ' ' || c.last_name as contact_name
        FROM tender_specialties ts
        LEFT JOIN contacts c ON ts.contact_id = c.id
        WHERE ts.tender_id = ?
      `).all(id);
      
      res.status(201).json({ ...tender, specialties_list: specialties });
    } catch (error: any) {
      console.error("Error creating tender:", error);
      res.status(500).json({ error: "Failed to create tender: " + error.message });
    }
  });

  app.put("/api/tenders/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { 
        title, client, submission_deadline, status, value, notes,
        mandataire_id, type, surface, construction_cost, honoraires_percent,
        mandatory_visit, visit_date, withdrawal_deadline, specialties_list, milestones_list
      } = req.body;
      
      const updateTender = db.transaction(() => {
        db.prepare(`
          UPDATE tenders SET 
            title = ?, client = ?, submission_deadline = ?, status = ?, value = ?, notes = ?,
            mandataire_id = ?, type = ?, surface = ?, construction_cost = ?, honoraires_percent = ?,
            mandatory_visit = ?, visit_date = ?, withdrawal_deadline = ?
          WHERE id = ?
        `).run(
          title, client, submission_deadline, status, value || 0, notes || '',
          mandataire_id || null, type || null, surface || 0, construction_cost || 0, honoraires_percent || 0,
          mandatory_visit ? 1 : 0, visit_date || null, withdrawal_deadline || null, id
        );

        // Update specialties
        db.prepare("DELETE FROM tender_specialties WHERE tender_id = ?").run(id);
        if (specialties_list && Array.isArray(specialties_list)) {
          const stmt = db.prepare(`
            INSERT INTO tender_specialties (id, tender_id, specialty_name, contact_id)
            VALUES (?, ?, ?, ?)
          `);
          for (const spec of specialties_list) {
            stmt.run(`ts${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, spec.specialty_name, spec.contact_id || null);
          }
        }

        // Update milestones
        db.prepare("DELETE FROM milestones WHERE tender_id = ?").run(id);
        if (milestones_list && Array.isArray(milestones_list)) {
          const stmt = db.prepare(`
            INSERT INTO milestones (id, tender_id, title, due_date, completed)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const m of milestones_list) {
            stmt.run(`m${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, m.title, m.due_date, m.completed ? 1 : 0);
          }
        }
      });

      updateTender();
      
      const tender = db.prepare(`
        SELECT t.*, c.first_name || ' ' || c.last_name as mandataire_name 
        FROM tenders t
        LEFT JOIN contacts c ON t.mandataire_id = c.id
        WHERE t.id = ?
      `).get(id);
      
      const specialties = db.prepare(`
        SELECT ts.*, c.first_name || ' ' || c.last_name as contact_name
        FROM tender_specialties ts
        LEFT JOIN contacts c ON ts.contact_id = c.id
        WHERE ts.tender_id = ?
      `).all(id);
      
      res.json({ ...tender, specialties_list: specialties });
    } catch (error: any) {
      console.error("Error updating tender:", error);
      res.status(500).json({ error: "Failed to update tender: " + error.message });
    }
  });

  app.get("/api/milestones", (req, res) => {
    try {
      const { project_id, tender_id, proposal_id } = req.query;
      let milestones;
      if (project_id) {
        milestones = db.prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date ASC").all(project_id);
      } else if (tender_id) {
        milestones = db.prepare("SELECT * FROM milestones WHERE tender_id = ? ORDER BY due_date ASC").all(tender_id);
      } else if (proposal_id) {
        milestones = db.prepare("SELECT * FROM milestones WHERE proposal_id = ? ORDER BY due_date ASC").all(proposal_id);
      } else {
        milestones = db.prepare("SELECT * FROM milestones ORDER BY due_date ASC").all();
      }
      res.json(milestones);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch milestones" });
    }
  });

  app.post("/api/milestones", (req, res) => {
    try {
      const { project_id, tender_id, proposal_id, title, due_date, completed } = req.body;
      const id = `m${Date.now()}`;
      db.prepare(`
        INSERT INTO milestones (id, project_id, tender_id, proposal_id, title, due_date, completed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, project_id || null, tender_id || null, proposal_id || null, title, due_date, completed ? 1 : 0);
      
      const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id);
      res.status(201).json(milestone);
    } catch (error: any) {
      console.error("Error creating milestone:", error);
      res.status(500).json({ error: "Failed to create milestone: " + error.message });
    }
  });

  app.put("/api/milestones/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { title, due_date, completed } = req.body;
      db.prepare(`
        UPDATE milestones 
        SET title = ?, due_date = ?, completed = ?
        WHERE id = ?
      `).run(title, due_date, completed ? 1 : 0, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating milestone:", error);
      res.status(500).json({ error: "Failed to update milestone: " + error.message });
    }
  });

  app.delete("/api/milestones/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting milestone:", error);
      res.status(500).json({ error: "Failed to delete milestone: " + error.message });
    }
  });

  app.get("/api/specifications", (req, res) => {
    try {
      const specs = db.prepare("SELECT * FROM specifications ORDER BY last_updated DESC").all();
      res.json(specs.map((s: any) => ({ ...s, is_template: !!s.is_template })));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch specifications" });
    }
  });

  app.post("/api/specifications", (req, res) => {
    try {
      const { id, project_id, title, content, is_template } = req.body;
      const last_updated = new Date().toISOString();
      db.prepare(`
        INSERT INTO specifications (id, project_id, title, content, last_updated, is_template)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, project_id, title, content, last_updated, is_template ? 1 : 0);
      res.status(201).json({ id, last_updated });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to create specification: " + error.message });
    }
  });

  app.put("/api/specifications/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, is_template } = req.body;
      const last_updated = new Date().toISOString();
      db.prepare(`
        UPDATE specifications 
        SET title = ?, content = ?, last_updated = ?, is_template = ?
        WHERE id = ?
      `).run(title, content, last_updated, is_template ? 1 : 0, id);
      res.json({ success: true, last_updated });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to update specification: " + error.message });
    }
  });

  app.delete("/api/specifications/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM specifications WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete specification: " + error.message });
    }
  });

  app.get("/api/contacts", (req, res) => {
    try {
      const contacts = db.prepare("SELECT *, first_name || ' ' || last_name as name FROM contacts").all();
      res.json(contacts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  app.post("/api/contacts", (req, res) => {
    try {
      const contact = req.body;
      const sanitize = (val: any) => val === undefined ? null : val;

      const stmt = db.prepare(`
        INSERT INTO contacts (
          id, prefix, first_name, middle_name, last_name, suffix, nickname,
          company_name, job_title, department,
          email_work, email_home, email_other, email,
          phone_mobile, phone_work, phone_home, phone_main, phone_fax_work, phone_fax_home, phone_pager, phone_other, phone,
          address_work_street, address_work_city, address_work_state, address_work_zip, address_work_country,
          address_home_street, address_home_city, address_home_state, address_home_zip, address_home_country,
          address, zip, city, state, country,
          candidatures, affaires, logo, ca_amount, electronic_signature, contact_references, 
          tags, category, notes, birthday, website, created_at, created_by, siret, vat_number
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      
      stmt.run(
        sanitize(contact.id), 
        sanitize(contact.prefix), 
        sanitize(contact.first_name), 
        sanitize(contact.middle_name), 
        sanitize(contact.last_name), 
        sanitize(contact.suffix), 
        sanitize(contact.nickname), 
        sanitize(contact.company_name), 
        sanitize(contact.job_title), 
        sanitize(contact.department), 
        sanitize(contact.email_work), 
        sanitize(contact.email_home), 
        sanitize(contact.email_other), 
        sanitize(contact.email), 
        sanitize(contact.phone_mobile), 
        sanitize(contact.phone_work), 
        sanitize(contact.phone_home), 
        sanitize(contact.phone_main), 
        sanitize(contact.phone_fax_work), 
        sanitize(contact.phone_fax_home), 
        sanitize(contact.phone_pager), 
        sanitize(contact.phone_other), 
        sanitize(contact.phone), 
        sanitize(contact.address_work_street), 
        sanitize(contact.address_work_city), 
        sanitize(contact.address_work_state), 
        sanitize(contact.address_work_zip), 
        sanitize(contact.address_work_country), 
        sanitize(contact.address_home_street), 
        sanitize(contact.address_home_city), 
        sanitize(contact.address_home_state), 
        sanitize(contact.address_home_zip), 
        sanitize(contact.address_home_country), 
        sanitize(contact.address), 
        sanitize(contact.zip), 
        sanitize(contact.city), 
        sanitize(contact.state), 
        sanitize(contact.country), 
        sanitize(contact.candidatures), 
        sanitize(contact.affaires), 
        sanitize(contact.logo), 
        sanitize(contact.ca_amount), 
        sanitize(contact.electronic_signature), 
        sanitize(contact.contact_references), 
        sanitize(contact.tags), 
        sanitize(contact.category),
        sanitize(contact.notes),
        sanitize(contact.birthday),
        sanitize(contact.website),
        sanitize(contact.created_at), 
        sanitize(contact.created_by),
        sanitize(contact.siret),
        sanitize(contact.vat_number)
      );
      
      res.status(201).json({ id: contact.id });
    } catch (error: any) {
      console.error("Error creating contact:", error.message);
      res.status(500).json({ error: "Failed to create contact: " + error.message });
    }
  });

  app.put("/api/contacts/:id", (req, res) => {
    try {
      const { id } = req.params;
      const contact = req.body;
      const sanitize = (val: any) => val === undefined ? null : val;

      const stmt = db.prepare(`
        UPDATE contacts SET 
          prefix = ?, first_name = ?, middle_name = ?, last_name = ?, suffix = ?, nickname = ?, 
          company_name = ?, job_title = ?, department = ?, 
          email_work = ?, email_home = ?, email_other = ?, email = ?, 
          phone_mobile = ?, phone_work = ?, phone_home = ?, phone_main = ?, phone_fax_work = ?, phone_fax_home = ?, phone_pager = ?, phone_other = ?, phone = ?, 
          address_work_street = ?, address_work_city = ?, address_work_state = ?, address_work_zip = ?, address_work_country = ?, 
          address_home_street = ?, address_home_city = ?, address_home_state = ?, address_home_zip = ?, address_home_country = ?, 
          address = ?, zip = ?, city = ?, state = ?, country = ?, 
          candidatures = ?, affaires = ?, logo = ?, ca_amount = ?, electronic_signature = ?, 
          contact_references = ?, tags = ?, category = ?, notes = ?, birthday = ?, website = ?, siret = ?, vat_number = ?
        WHERE id = ?
      `);
      
      stmt.run(
        sanitize(contact.prefix), 
        sanitize(contact.first_name), 
        sanitize(contact.middle_name), 
        sanitize(contact.last_name), 
        sanitize(contact.suffix), 
        sanitize(contact.nickname), 
        sanitize(contact.company_name), 
        sanitize(contact.job_title), 
        sanitize(contact.department), 
        sanitize(contact.email_work), 
        sanitize(contact.email_home), 
        sanitize(contact.email_other), 
        sanitize(contact.email), 
        sanitize(contact.phone_mobile), 
        sanitize(contact.phone_work), 
        sanitize(contact.phone_home), 
        sanitize(contact.phone_main), 
        sanitize(contact.phone_fax_work), 
        sanitize(contact.phone_fax_home), 
        sanitize(contact.phone_pager), 
        sanitize(contact.phone_other), 
        sanitize(contact.phone), 
        sanitize(contact.address_work_street), 
        sanitize(contact.address_work_city), 
        sanitize(contact.address_work_state), 
        sanitize(contact.address_work_zip), 
        sanitize(contact.address_work_country), 
        sanitize(contact.address_home_street), 
        sanitize(contact.address_home_city), 
        sanitize(contact.address_home_state), 
        sanitize(contact.address_home_zip), 
        sanitize(contact.address_home_country), 
        sanitize(contact.address), 
        sanitize(contact.zip), 
        sanitize(contact.city), 
        sanitize(contact.state), 
        sanitize(contact.country), 
        sanitize(contact.candidatures), 
        sanitize(contact.affaires), 
        sanitize(contact.logo), 
        sanitize(contact.ca_amount), 
        sanitize(contact.electronic_signature), 
        sanitize(contact.contact_references), 
        sanitize(contact.tags), 
        sanitize(contact.category),
        sanitize(contact.notes),
        sanitize(contact.birthday),
        sanitize(contact.website),
        sanitize(contact.siret),
        sanitize(contact.vat_number),
        id
      );
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating contact:", error.message);
      res.status(500).json({ error: "Failed to update contact: " + error.message });
    }
  });

  app.delete("/api/contacts/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting contact:", error.message);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.get("/api/contact_categories", (req, res) => {
    try {
      const categories = db.prepare("SELECT * FROM contact_categories ORDER BY name").all();
      res.json(categories);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch contact categories" });
    }
  });

  app.get("/api/proposals", (req, res) => {
    try {
      const proposals = db.prepare(`
        SELECT p.*, c.first_name || ' ' || c.last_name as client_name 
        FROM proposals p
        LEFT JOIN contacts c ON p.client_id = c.id
        ORDER BY p.created_at DESC
      `).all();
      
      const proposalsWithSpecialties = proposals.map((proposal: any) => {
        const specialties = db.prepare(`
          SELECT ps.*, c.first_name || ' ' || c.last_name as contact_name
          FROM proposal_specialties ps
          LEFT JOIN contacts c ON ps.contact_id = c.id
          WHERE ps.proposal_id = ?
        `).all(proposal.id);
        return { ...proposal, specialties_list: specialties };
      });
      
      res.json(proposalsWithSpecialties);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch proposals" });
    }
  });

  app.post("/api/proposals", (req, res) => {
    try {
      const p = req.body;
      const id = `prop${Date.now()}`;
      const created_at = new Date().toISOString();
      
      const insertProposal = db.transaction(() => {
        const stmt = db.prepare(`
          INSERT INTO proposals (
            id, title, client_id, amount, status, description, created_at,
            reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
            adresse_client, cp_client, ville_client, telephone, portable, email_client,
            adresse_terrain, cp_ville_terrain, ref_cadastrale, zone_plu, surface_parcelle,
            nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
            categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
            surface_ert, effectif_public, effectif_personnel, ind, date_modification,
            project_code, project_number, project_status, keywords, notes,
            site_name, site_description, site_id, site_address_1, site_address_2, site_address_3,
            site_postbox, site_city, site_state, site_postcode, site_country, site_gross_perimeter, site_gross_area,
            building_name, building_description, building_id,
            contact_fullname, contact_prefixtitle, contact_givenname, contact_middlename, contact_familyname,
            contact_suffixtitle, contact_nameorder, contact_id, contact_role, contact_department,
            contact_company, contact_companycode, contact_fulladdress, contact_address_1, contact_address_2,
            contact_address_3, contact_postbox, contact_city, contact_state, contact_postcode,
            contact_country, contact_email, contact_phone, contact_fax, contact_web,
            cad_technician_fullname, cad_technician_prefixtitle, cad_technician_givenname, cad_technician_middlename,
            cad_technician_familyname, cad_technician_suffixtitle, cad_technician_nameorder,
            client_fullname, client_prefixtitle, client_givenname, client_middlename, client_familyname,
            client_suffixtitle, client_nameorder, client_company, client_fulladdress, client_address_1,
            client_address_2, client_address_3, client_postbox, client_city, client_state,
            client_postcode, client_country, client_email, client_phone, client_fax,
            ed_report_header, custom_building, custom_architect, custom_client
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `);

        stmt.run(
          id, p.title, p.client_id || null, p.amount || 0, p.status || 'Draft', p.description || '', created_at,
          p.reference, p.projet_detail, p.is_entreprise ? 1 : 0, p.nom_societe, p.rcs, p.representant, p.qualite,
          p.adresse_client, p.cp_client, p.ville_client, p.telephone, p.portable, p.email_client,
          p.adresse_terrain, p.cp_ville_terrain, p.ref_cadastrale, p.zone_plu, p.surface_parcelle,
          p.nom_etablissement, p.avant_trav, p.apres_trav, p.type_et_cat, p.type_projet,
          p.categorie_projet, p.surface_plancher, p.surface_plancher_ext, p.surface_erp,
          p.surface_ert, p.effectif_public, p.effectif_personnel, p.ind, p.date_modification,
          p.project_code, p.project_number, p.project_status, p.keywords, p.notes,
          p.site_name, p.site_description, p.site_id, p.site_address_1, p.site_address_2, p.site_address_3,
          p.site_postbox, p.site_city, p.site_state, p.site_postcode, p.site_country, p.site_gross_perimeter, p.site_gross_area,
          p.building_name, p.building_description, p.building_id,
          p.contact_fullname, p.contact_prefixtitle, p.contact_givenname, p.contact_middlename, p.contact_familyname,
          p.contact_suffixtitle, p.contact_nameorder, p.contact_id || null, p.contact_role, p.contact_department,
          p.contact_company, p.contact_companycode, p.contact_fulladdress, p.contact_address_1, p.contact_address_2,
          p.contact_address_3, p.contact_postbox, p.contact_city, p.contact_state, p.contact_postcode,
          p.contact_country, p.contact_email, p.contact_phone, p.contact_fax, p.contact_web,
          p.cad_technician_fullname, p.cad_technician_prefixtitle, p.cad_technician_givenname, p.cad_technician_middlename,
          p.cad_technician_familyname, p.cad_technician_suffixtitle, p.cad_technician_nameorder,
          p.client_fullname, p.client_prefixtitle, p.client_givenname, p.client_middlename, p.client_familyname,
          p.client_suffixtitle, p.client_nameorder, p.client_company, p.client_fulladdress, p.client_address_1,
          p.client_address_2, p.client_address_3, p.client_postbox, p.client_city, p.client_state,
          p.client_postcode, p.client_country, p.client_email, p.client_phone, p.client_fax,
          p.ed_report_header, p.custom_building, p.custom_architect, p.custom_client
        );

        if (p.specialties_list && Array.isArray(p.specialties_list)) {
          const specStmt = db.prepare(`
            INSERT INTO proposal_specialties (id, proposal_id, specialty_name, contact_id)
            VALUES (?, ?, ?, ?)
          `);
          for (const spec of p.specialties_list) {
            specStmt.run(`ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, spec.specialty_name, spec.contact_id || null);
          }
        }
      });

      insertProposal();
      
      const proposal = db.prepare(`
        SELECT p.*, c.first_name || ' ' || c.last_name as client_name 
        FROM proposals p
        LEFT JOIN contacts c ON p.client_id = c.id
        WHERE p.id = ?
      `).get(id);
      
      const specialties = db.prepare(`
        SELECT ps.*, c.first_name || ' ' || c.last_name as contact_name
        FROM proposal_specialties ps
        LEFT JOIN contacts c ON ps.contact_id = c.id
        WHERE ps.proposal_id = ?
      `).all(id);
      
      res.status(201).json({ ...proposal, specialties_list: specialties });
    } catch (error: any) {
      console.error("Error creating proposal:", error);
      res.status(500).json({ error: "Failed to create proposal: " + error.message });
    }
  });

  app.put("/api/proposals/:id", (req, res) => {
    try {
      const { id } = req.params;
      const p = req.body;
      
      const oldProposal = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
      
      const updateProposal = db.transaction(() => {
        const stmt = db.prepare(`
          UPDATE proposals 
          SET title = ?, client_id = ?, amount = ?, description = ?, status = ?,
              reference = ?, projet_detail = ?, is_entreprise = ?, nom_societe = ?, rcs = ?, 
              representant = ?, qualite = ?, adresse_client = ?, cp_client = ?, ville_client = ?, 
              telephone = ?, portable = ?, email_client = ?, adresse_terrain = ?, cp_ville_terrain = ?, 
              ref_cadastrale = ?, zone_plu = ?, surface_parcelle = ?, nom_etablissement = ?, 
              avant_trav = ?, apres_trav = ?, type_et_cat = ?, type_projet = ?, 
              categorie_projet = ?, surface_plancher = ?, surface_plancher_ext = ?, 
              surface_erp = ?, surface_ert = ?, effectif_public = ?, effectif_personnel = ?, 
              ind = ?, date_modification = ?,
              project_code = ?, project_number = ?, project_status = ?, keywords = ?, notes = ?,
              site_name = ?, site_description = ?, site_id = ?, site_address_1 = ?, site_address_2 = ?, site_address_3 = ?,
              site_postbox = ?, site_city = ?, site_state = ?, site_postcode = ?, site_country = ?, site_gross_perimeter = ?, site_gross_area = ?,
              building_name = ?, building_description = ?, building_id = ?,
              contact_fullname = ?, contact_prefixtitle = ?, contact_givenname = ?, contact_middlename = ?, contact_familyname = ?,
              contact_suffixtitle = ?, contact_nameorder = ?, contact_id = ?, contact_role = ?, contact_department = ?,
              contact_company = ?, contact_companycode = ?, contact_fulladdress = ?, contact_address_1 = ?, contact_address_2 = ?,
              contact_address_3 = ?, contact_postbox = ?, contact_city = ?, contact_state = ?, contact_postcode = ?,
              contact_country = ?, contact_email = ?, contact_phone = ?, contact_fax = ?, contact_web = ?,
              cad_technician_fullname = ?, cad_technician_prefixtitle = ?, cad_technician_givenname = ?, cad_technician_middlename = ?,
              cad_technician_familyname = ?, cad_technician_suffixtitle = ?, cad_technician_nameorder = ?,
              client_fullname = ?, client_prefixtitle = ?, client_givenname = ?, client_middlename = ?, client_familyname = ?,
              client_suffixtitle = ?, client_nameorder = ?, client_company = ?, client_fulladdress = ?, client_address_1 = ?,
              client_address_2 = ?, client_address_3 = ?, client_postbox = ?, client_city = ?, client_state = ?,
              client_postcode = ?, client_country = ?, client_email = ?, client_phone = ?, client_fax = ?,
              ed_report_header = ?, custom_building = ?, custom_architect = ?, custom_client = ?
          WHERE id = ?
        `);

        stmt.run(
          p.title, p.client_id || null, p.amount, p.description, p.status,
          p.reference, p.projet_detail, p.is_entreprise ? 1 : 0, p.nom_societe, p.rcs, 
          p.representant, p.qualite, p.adresse_client, p.cp_client, p.ville_client, 
          p.telephone, p.portable, p.email_client, p.adresse_terrain, p.cp_ville_terrain, 
          p.ref_cadastrale, p.zone_plu, p.surface_parcelle, p.nom_etablissement, 
          p.avant_trav, p.apres_trav, p.type_et_cat, p.type_projet, 
          p.categorie_projet, p.surface_plancher, p.surface_plancher_ext, 
          p.surface_erp, p.surface_ert, p.effectif_public, p.effectif_personnel, 
          p.ind, p.date_modification,
          p.project_code, p.project_number, p.project_status, p.keywords, p.notes,
          p.site_name, p.site_description, p.site_id, p.site_address_1, p.site_address_2, p.site_address_3,
          p.site_postbox, p.site_city, p.site_state, p.site_postcode, p.site_country, p.site_gross_perimeter, p.site_gross_area,
          p.building_name, p.building_description, p.building_id,
          p.contact_fullname, p.contact_prefixtitle, p.contact_givenname, p.contact_middlename, p.contact_familyname,
          p.contact_suffixtitle, p.contact_nameorder, p.contact_id || null, p.contact_role, p.contact_department,
          p.contact_company, p.contact_companycode, p.contact_fulladdress, p.contact_address_1, p.contact_address_2,
          p.contact_address_3, p.contact_postbox, p.contact_city, p.contact_state, p.contact_postcode,
          p.contact_country, p.contact_email, p.contact_phone, p.contact_fax, p.contact_web,
          p.cad_technician_fullname, p.cad_technician_prefixtitle, p.cad_technician_givenname, p.cad_technician_middlename,
          p.cad_technician_familyname, p.cad_technician_suffixtitle, p.cad_technician_nameorder,
          p.client_fullname, p.client_prefixtitle, p.client_givenname, p.client_middlename, p.client_familyname,
          p.client_suffixtitle, p.client_nameorder, p.client_company, p.client_fulladdress, p.client_address_1,
          p.client_address_2, p.client_address_3, p.client_postbox, p.client_city, p.client_state,
          p.client_postcode, p.client_country, p.client_email, p.client_phone, p.client_fax,
          p.ed_report_header, p.custom_building, p.custom_architect, p.custom_client,
          id
        );

        // Update specialties
        db.prepare("DELETE FROM proposal_specialties WHERE proposal_id = ?").run(id);
        if (p.specialties_list && Array.isArray(p.specialties_list)) {
          const specStmt = db.prepare(`
            INSERT INTO proposal_specialties (id, proposal_id, specialty_name, contact_id)
            VALUES (?, ?, ?, ?)
          `);
          for (const spec of p.specialties_list) {
            specStmt.run(`ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, spec.specialty_name, spec.contact_id || null);
          }
        }

        // If status changed to 'Accepted', create a project
        if (p.status === 'Accepted' && oldProposal.status !== 'Accepted') {
          const projectId = `p${Date.now()}`;
          const client = db.prepare("SELECT first_name || ' ' || last_name as name FROM contacts WHERE id = ?").get(p.client_id);
          
          db.prepare(`
            INSERT INTO projects (id, name, client, status, budget, description, start_date, end_date, address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            projectId, 
            p.title, 
            client ? client.name : 'Unknown Client', 
            'Planning', 
            p.amount, 
            p.description,
            new Date().toISOString().split('T')[0],
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default 30 days
            p.adresse_terrain ? `${p.adresse_terrain}, ${p.cp_ville_terrain || ''}` : ''
          );

          // Copy specialties to project cotraitants
          if (p.specialties_list && Array.isArray(p.specialties_list)) {
            const cotStmt = db.prepare(`
              INSERT INTO project_cotraitants (id, project_id, specialty, contact_id)
              VALUES (?, ?, ?, ?)
            `);
            for (const spec of p.specialties_list) {
              cotStmt.run(`pc${Date.now()}${Math.random().toString(36).substr(2, 5)}`, projectId, spec.specialty_name, spec.contact_id || null);
            }
          }
        }
      });

      updateProposal();

      const proposal = db.prepare(`
        SELECT p.*, c.first_name || ' ' || c.last_name as client_name 
        FROM proposals p
        LEFT JOIN contacts c ON p.client_id = c.id
        WHERE p.id = ?
      `).get(id);
      
      const specialties = db.prepare(`
        SELECT ps.*, c.first_name || ' ' || c.last_name as contact_name
        FROM proposal_specialties ps
        LEFT JOIN contacts c ON ps.contact_id = c.id
        WHERE ps.proposal_id = ?
      `).all(id);
      
      res.json({ ...proposal, specialties_list: specialties });
    } catch (error: any) {
      console.error("Error updating proposal:", error);
      res.status(500).json({ error: "Failed to update proposal: " + error.message });
    }
  });

  app.get("/api/proposals/:id/export", (req, res) => {
    const proposal = db.prepare("SELECT * FROM proposals WHERE id = ?").get(req.params.id) as any;
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    
    const xml = proposalToXml(proposal);
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename=proposal_${proposal.id}.xml`);
    res.send(xml);
  });

  app.post("/api/proposals/import", upload.single("file"), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const xml = req.file.buffer.toString();
      const proposalData = xmlToProposal(xml);
      
      const id = `prop${Date.now()}`;
      const created_at = new Date().toISOString();
      
      // Basic insert, assuming proposalData has the fields
      const stmt = db.prepare(`
        INSERT INTO proposals (id, title, description, created_at, status)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, proposalData.title || 'Imported Proposal', proposalData.description || '', created_at, 'Draft');
      
      res.json({ success: true, id });
    } catch (error: any) {
      console.error("Error importing proposal:", error);
      res.status(500).json({ error: "Failed to import proposal: " + error.message });
    }
  });

  app.get("/api/invoices", (req, res) => {
    try {
      const invoices = db.prepare(`
        SELECT i.*, p.name as project_name 
        FROM invoices i
        LEFT JOIN projects p ON i.project_id = p.id
        ORDER BY i.created_at DESC
      `).all();
      
      const invoicesWithItems = invoices.map((inv: any) => {
        const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id);
        return { ...inv, items };
      });
      
      res.json(invoicesWithItems);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoices", (req, res) => {
    try {
      const { 
        project_id, amount, description, status, due_date, 
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        items 
      } = req.body;
      
      const id = `inv${Date.now()}`;
      const created_at = new Date().toISOString();
      
      // Fetch default seller info from settings if not provided
      let finalSellerName = seller_name;
      let finalSellerAddress = seller_address;
      let finalSellerSiret = seller_siret;
      let finalSellerVatNumber = seller_vat_number;
      let finalSellerIban = seller_iban;
      let finalSellerBic = seller_bic;

      if (!finalSellerName || !finalSellerAddress || !finalSellerSiret) {
        const settings = db.prepare("SELECT * FROM settings LIMIT 1").get() as any;
        if (settings) {
          finalSellerName = finalSellerName || settings.agencyName;
          finalSellerAddress = finalSellerAddress || settings.address;
          finalSellerSiret = finalSellerSiret || settings.siret;
          finalSellerVatNumber = finalSellerVatNumber || settings.vatNumber;
          finalSellerIban = finalSellerIban || settings.seller_iban;
          finalSellerBic = finalSellerBic || settings.seller_bic;
        }
      }

      const insertInvoice = db.transaction(() => {
        db.prepare(`
          INSERT INTO invoices (
            id, invoice_number, project_id, amount, tax_amount, total_amount, 
            status, due_date, issue_date, description, created_at,
            seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, invoice_number || null, project_id, amount || 0, tax_amount || 0, total_amount || 0,
          status || 'Draft', due_date, issue_date || created_at.split('T')[0], 
          description || '', created_at,
          finalSellerName || null, finalSellerAddress || null, finalSellerSiret || null, finalSellerVatNumber || null, finalSellerIban || null, finalSellerBic || null, vat_rate || 20
        );

        if (items && Array.isArray(items)) {
          const stmt = db.prepare(`
            INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, vat_rate)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const item of items) {
            stmt.run(`ii${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, item.description, item.quantity, item.unit_price, item.vat_rate);
          }
        }
      });

      insertInvoice();
      
      const invoice = db.prepare(`
        SELECT i.*, p.name as project_name 
        FROM invoices i
        LEFT JOIN projects p ON i.project_id = p.id
        WHERE i.id = ?
      `).get(id);
      
      const savedItems = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(id);
      res.status(201).json({ ...invoice, items: savedItems });
    } catch (error: any) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ error: "Failed to create invoice: " + error.message });
    }
  });

  app.put("/api/invoices/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { 
        amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        items
      } = req.body;
      
      const updateInvoice = db.transaction(() => {
        db.prepare(`
          UPDATE invoices 
          SET amount = ?, description = ?, status = ?, due_date = ?,
              invoice_number = ?, tax_amount = ?, total_amount = ?, issue_date = ?,
              seller_name = ?, seller_address = ?, seller_siret = ?, seller_vat_number = ?, seller_iban = ?, seller_bic = ?, vat_rate = ?
          WHERE id = ?
        `).run(
          amount, description, status, due_date,
          invoice_number, tax_amount, total_amount, issue_date,
          seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
          id
        );

        if (items && Array.isArray(items)) {
          // Simplified: delete and recreate items
          db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(id);
          const stmt = db.prepare(`
            INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, vat_rate)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const item of items) {
            stmt.run(item.id || `ii${Date.now()}${Math.random().toString(36).substr(2, 5)}`, id, item.description, item.quantity, item.unit_price, item.vat_rate);
          }
        }
      });

      updateInvoice();
      
      const invoice = db.prepare(`
        SELECT i.*, p.name as project_name 
        FROM invoices i
        LEFT JOIN projects p ON i.project_id = p.id
        WHERE i.id = ?
      `).get(id);
      
      const savedItems = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(id);
      res.json({ ...invoice, items: savedItems });
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ error: "Failed to update invoice: " + error.message });
    }
  });

  app.post("/api/contact_categories", (req, res) => {
    try {
      const { id, name } = req.body;
      db.prepare("INSERT INTO contact_categories (id, name) VALUES (?, ?)").run(id, name);
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create contact category" });
    }
  });

  app.delete("/api/contact_categories/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM contact_categories WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete contact category" });
    }
  });

  app.get("/api/address-search", async (req, res) => {
    try {
      const { q, banId } = req.query;
      
      if (!q && !banId) {
        return res.status(400).json({ error: "Query parameter 'q' or 'banId' is required" });
      }

      let data: any;

      // If we have a banId, try to get the specific address details first
      if (banId) {
        console.log(`Searching for address by banId: ${banId}`);
        // Try BDNB first for consistency
        const bdnbUrl = `https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse?cle_interop_adr=eq.${banId}&select=cle_interop_adr,libelle_adr,code_commune_insee,code_postal,nom_commune`;
        try {
          const bdnbRes = await fetchWithTimeout(bdnbUrl, { headers: { 'Accept': 'application/json' } }, 5000);
          if (bdnbRes.ok) {
            const bdnbData = await bdnbRes.json();
            if (Array.isArray(bdnbData) && bdnbData.length > 0) {
              data = bdnbData;
            }
          }
        } catch (e) {
          console.warn("BDNB lookup by banId failed, falling back to standard geocoder");
        }
      }

      // If no data yet and we have a query string
      if (!data && q) {
        // Use the BDNB geocoder
        let url = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=5`;
        console.log(`Fetching addresses for query: ${q}, URL: ${url}`);
        
        let response = await fetchWithTimeout(url, {
          headers: { 'Accept': 'application/json' }
        }, 15000);
        
        if (response.ok) {
          try {
            const text = await response.text();
            data = JSON.parse(text);
          } catch (e) {
            console.warn(`Failed to parse BDNB JSON.`);
          }
        }

        // Fallback to api-adresse.data.gouv.fr if BDNB fails or returns no results
        if (!data || (Array.isArray(data) && data.length === 0)) {
          console.log(`BDNB returned no results, trying api-adresse.data.gouv.fr for query: ${q}`);
          url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q as string)}&limit=5`;
          response = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/json' }
          }, 15000);
          
          if (response.ok) {
            const fallbackData = await response.json();
            if (fallbackData.features) {
              data = fallbackData.features.map((f: any) => ({
                cle_interop_adr: f.properties.id,
                libelle_adr: f.properties.label,
                code_commune_insee: f.properties.citycode,
                code_postal: f.properties.postcode,
                nom_commune: f.properties.city,
                score: f.properties.score,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0]
              }));
            }
          }
        }
      }
      
      const results = Array.isArray(data) ? data : [];
      if (!Array.isArray(data)) {
        console.warn(`Geocoder returned non-array data: ${JSON.stringify(data).substring(0, 200)}`);
      }
      
      const features = results.map((item: any) => ({
        properties: {
          label: item.libelle_adr || item.nom_commune || "Unknown address",
          score: item.score || 0,
          id: item.cle_interop_adr || "",
          name: item.libelle_adr || "",
          postcode: item.code_postal || "",
          citycode: item.code_commune_insee || "",
          city: item.nom_commune || "",
          context: `${item.code_postal || ""} ${item.nom_commune || ""}`,
          importance: item.score || 0
        },
        geometry: {
          type: "Point",
          coordinates: [item.lon || 0, item.lat || 0]
        }
      }));

      res.json({ features });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("BDNB Geocodage request timed out");
        return res.status(504).json({ error: "BDNB Geocodage request timed out" });
      }
      console.error("Error in /api/address-search:", error);
      res.status(500).json({ error: "Failed to fetch addresses" });
    }
  });

  // Proxy for Urban Planning (GPU) API
  app.get("/api/urban-planning/documents", async (req, res) => {
    try {
      const { insee, grid, partition } = req.query;
      let url = "";
      
      if (grid) {
        url = `https://www.geoportail-urbanisme.gouv.fr/api/document?grid=${grid}&status=document.production`;
      } else if (partition) {
        url = `https://www.geoportail-urbanisme.gouv.fr/api/document?partition=${partition}&status=document.production`;
      } else if (insee) {
        // Default to grid search if only insee is provided
        url = `https://www.geoportail-urbanisme.gouv.fr/api/document?grid=${insee}&status=document.production`;
      } else {
        return res.status(400).json({ error: "Missing search parameters (insee, grid, or partition)" });
      }

      console.log(`[GPU] Fetching documents: ${url}`);
      const response = await fetchWithTimeout(url, {}, 10000);
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `GPU API error: ${response.status}` });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text();
        console.error(`[GPU] Non-JSON response: ${text.substring(0, 200)}`);
        res.status(502).json({ error: "Invalid response from GPU API", details: text.substring(0, 200) });
      }
    } catch (error: any) {
      console.error("[GPU] Proxy Error:", error);
      res.status(500).json({ error: "Internal server error during GPU lookup" });
    }
  });

  app.get("/api/urban-planning/details/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const url = `https://www.geoportail-urbanisme.gouv.fr/api/document/${id}/details`;
      
      console.log(`[GPU] Fetching details for ${id}`);
      const response = await fetchWithTimeout(url, {}, 10000);
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `GPU Details error: ${response.status}` });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(502).json({ error: "Invalid response from GPU Details API" });
      }
    } catch (error: any) {
      console.error("[GPU] Details Proxy Error:", error);
      res.status(500).json({ error: "Internal server error during GPU details lookup" });
    }
  });

  // Proxy for Historical Monuments (Culture API)
  app.get("/api/historical-monuments", async (req, res) => {
    try {
      const { lat, lon, distance = 1000 } = req.query;
      if (!lat || !lon) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const url = `https://data.culture.gouv.fr/api/records/1.0/search/?dataset=liste-des-immeubles-proteges-au-titre-des-monuments-historiques&q=&geofilter.distance=${lat},${lon},${distance}&rows=10&sort=dist`;
      
      console.log(`[Culture] Fetching monuments: ${url}`);
      const response = await fetchWithTimeout(url, {}, 10000);
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `Culture API error: ${response.status}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Culture] Proxy Error:", error);
      res.status(500).json({ error: "Internal server error during Culture API lookup" });
    }
  });

  app.get("/api/cadastre/parcel", async (req, res) => {
    try {
      const { lon, lat } = req.query;
      console.log(`[Cadastre] Lookup request: lon=${lon}, lat=${lat}`);
      
      if (!lon || !lat) {
        return res.status(400).json({ error: "Missing longitude or latitude parameters" });
      }

      const apiUrl = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=%7B%22type%22%3A%22Point%22%2C%22coordinates%22%3A%5B${lon}%2C${lat}%5D%7D`;
      console.log(`[Cadastre] Fetching from IGN: ${apiUrl}`);

      const response = await fetchWithTimeout(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      }, 8000); // 8 second timeout

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response body');
        console.error(`[Cadastre] IGN API Error: ${response.status} ${response.statusText}`);
        return res.status(response.status).json({ 
          error: `IGN API returned ${response.status}: ${response.statusText}`,
          details: errorText
        });
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error(`Cadastre API returned non-JSON: ${text}`);
        return res.status(502).json({ error: "Cadastre API returned invalid response format" });
      }

      const data = await response.json();
      
      // Map IGN properties to the format expected by the frontend
      const mappedFeatures = (data.features || []).map((f: any) => {
        const p = f.properties;
        let id15 = p.idu;
        
        // Etalab requires exactly 15 characters for the parcel ID
        // IGN's IDU is often 14 characters (missing a leading zero in the 5-digit numero part)
        if (id15 && id15.length === 14) {
          // Insert the missing zero at the start of the numero part (index 10)
          id15 = id15.substring(0, 10) + '0' + id15.substring(10);
        } else if (!id15 || id15.length < 14) {
          // Fallback reconstruction if IDU is missing or malformed
          const section = (p.section || '').padStart(2, '0');
          const prefixe = (p.code_abs || '000').padStart(3, '0');
          const numero5 = (p.numero || '').padStart(5, '0');
          const commune = (p.code_insee || '').padStart(5, '0');
          id15 = `${commune}${prefixe}${section}${numero5}`;
        }
        
        // The commune code for the URL should be the one from the parcel ID (idu)
        // This is usually the most reliable for cadastral APIs
        const urlCommune = id15.substring(0, 5);

        console.log(`[Cadastre] Mapping: IGN=${p.idu} -> Etalab=${id15} (URL Commune: ${urlCommune}, INSEE: ${p.code_insee})`);

        return {
          properties: {
            id: id15,
            section: id15.substring(8, 10),
            numero: id15.substring(10),
            prefixe: id15.substring(5, 8),
            commune: urlCommune,
            insee: p.code_insee || urlCommune
          }
        };
      });

      console.log(`[Cadastre] Success: Found ${mappedFeatures.length} parcels`);
      res.json({ features: mappedFeatures });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("[Cadastre] Request timed out");
        return res.status(504).json({ error: "Cadastre API request timed out" });
      }
      console.error("[Cadastre] Proxy Exception:", error);
      res.status(500).json({ 
        error: "Internal server error during Cadastre lookup", 
        message: error.message 
      });
    }
  });

  app.post("/api/send-email", async (req, res) => {
    try {
      const { to, subject, text, html, attachments, userEmail } = req.body;
      
      // Get settings from DB
      const settings = db.prepare("SELECT * FROM settings WHERE id = 'general'").get() as any;
      if (!settings) {
        return res.status(500).json({ error: "Settings not found" });
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const from = settings.senderOption === 'personal' ? userEmail : settings.email;
      const cc = settings.senderOption === 'personal' ? settings.email : undefined;

      await transporter.sendMail({
        from,
        to,
        cc,
        subject,
        text,
        html,
        attachments
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email: " + error.message });
    }
  });

  app.get("/api/projects/:projectId/reports", (req, res) => {
    try {
      const { projectId } = req.params;
      const reports = db.prepare("SELECT * FROM site_reports WHERE project_id = ? ORDER BY date DESC").all(projectId);
      const parsedReports = reports.map(report => {
        let stakeholders = [];
        try { stakeholders = report.stakeholders ? JSON.parse(report.stakeholders) : []; } catch (e) { console.error("Error parsing stakeholders:", e); }
        let companies = [];
        try { companies = report.companies ? JSON.parse(report.companies) : []; } catch (e) { console.error("Error parsing companies:", e); }
        return { ...report, stakeholders, companies };
      });
      res.json(parsedReports);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/projects/:projectId/reports", (req, res) => {
    try {
      const { projectId } = req.params;
      const { date, report_number } = req.body;
      const id = `sr${Date.now()}`;
      
      const createReport = db.transaction(() => {
        db.prepare("INSERT INTO site_reports (id, project_id, date, report_number) VALUES (?, ?, ?, ?)").run(id, projectId, date, report_number);
        
        // Copy open tasks from previous report
        const previousReport = db.prepare("SELECT * FROM site_reports WHERE project_id = ? AND id != ? ORDER BY date DESC LIMIT 1").get(projectId, id);
        if (previousReport) {
            const openNotes = db.prepare("SELECT * FROM site_report_notes WHERE report_id = ? AND status = 'open'").all(previousReport.id);
            const insertNote = db.prepare("INSERT INTO site_report_notes (id, report_id, category, note_number, responsible_company, issue_date, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            for (const note of openNotes) {
                insertNote.run(`sn${Date.now()}${Math.random()}`, id, note.category, note.note_number, note.responsible_company, note.issue_date, note.due_date, 'open');
            }
        }
      });
      createReport();
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create report" });
    }
  });

  app.get("/api/reports/:reportId/notes", (req, res) => {
    try {
      const { reportId } = req.params;
      const notes = db.prepare("SELECT * FROM site_report_notes WHERE report_id = ?").all(reportId);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  app.post("/api/reports/:reportId/notes", (req, res) => {
    try {
      const { reportId } = req.params;
      const { category, note_number, responsible_company, issue_date, due_date } = req.body;
      const id = `sn${Date.now()}`;
      db.prepare("INSERT INTO site_report_notes (id, report_id, category, note_number, responsible_company, issue_date, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, reportId, category, note_number, responsible_company, issue_date, due_date);
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  app.put("/api/reports/:reportId", (req, res) => {
    try {
      const { reportId } = req.params;
      const { pageFormat, stakeholders, companies, meetingNotes, nextMeeting } = req.body;
      
      db.prepare(`
        UPDATE site_reports 
        SET pageFormat = ?, stakeholders = ?, companies = ?, meetingNotes = ?, nextMeeting = ?
        WHERE id = ?
      `).run(
        pageFormat || null,
        JSON.stringify(stakeholders || []),
        JSON.stringify(companies || []),
        meetingNotes || null,
        nextMeeting || null,
        reportId
      );
      
      const updatedReport = db.prepare("SELECT * FROM site_reports WHERE id = ?").get(reportId);
      res.json({
        ...updatedReport,
        stakeholders: (() => { try { return updatedReport.stakeholders ? JSON.parse(updatedReport.stakeholders) : []; } catch (e) { console.error("Error parsing stakeholders:", e); return []; } })(),
        companies: (() => { try { return updatedReport.companies ? JSON.parse(updatedReport.companies) : []; } catch (e) { console.error("Error parsing companies:", e); return []; } })()
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update report" });
    }
  });

  app.put("/api/notes/:noteId", (req, res) => {
    try {
      const { noteId } = req.params;
      const { category, responsible_company, text, status, due_date, realization_date } = req.body;
      db.prepare("UPDATE site_report_notes SET category = ?, responsible_company = ?, text = ?, status = ?, due_date = ?, realization_date = ? WHERE id = ?").run(category, responsible_company, text, status, due_date, realization_date, noteId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:noteId", (req, res) => {
    try {
      const { noteId } = req.params;
      db.prepare("DELETE FROM site_report_notes WHERE id = ?").run(noteId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  app.get("/api/projects/:projectId/cctp", (req, res) => {
    try {
      const { projectId } = req.params;
      const cctp = db.prepare("SELECT * FROM cctps WHERE project_id = ?").get(projectId) as any;
      if (cctp) {
        res.json(JSON.parse(cctp.data));
      } else {
        res.status(404).json({ error: "CCTP not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch CCTP" });
    }
  });

  app.post("/api/projects/:projectId/cctp", (req, res) => {
    try {
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? `cctp${Date.now()}` : data.id;
      data.id = id;
      
      const existing = db.prepare("SELECT id FROM cctps WHERE project_id = ?").get(projectId);
      if (existing) {
        db.prepare("UPDATE cctps SET data = ? WHERE project_id = ?").run(JSON.stringify(data), projectId);
      } else {
        db.prepare("INSERT INTO cctps (id, project_id, data) VALUES (?, ?, ?)").run(id, projectId, JSON.stringify(data));
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to save CCTP" });
    }
  });

  app.get("/api/projects/:projectId/dpgf", (req, res) => {
    try {
      const { projectId } = req.params;
      const dpgf = db.prepare("SELECT * FROM dpgfs WHERE project_id = ?").get(projectId) as any;
      if (dpgf) {
        res.json(JSON.parse(dpgf.data));
      } else {
        res.status(404).json({ error: "DPGF not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DPGF" });
    }
  });

  app.post("/api/projects/:projectId/dpgf", (req, res) => {
    try {
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? `dpgf${Date.now()}` : data.id;
      data.id = id;
      
      const existing = db.prepare("SELECT id FROM dpgfs WHERE project_id = ?").get(projectId);
      if (existing) {
        db.prepare("UPDATE dpgfs SET data = ? WHERE project_id = ?").run(JSON.stringify(data), projectId);
      } else {
        db.prepare("INSERT INTO dpgfs (id, project_id, data) VALUES (?, ?, ?)").run(id, projectId, JSON.stringify(data));
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to save DPGF" });
    }
  });

  app.get("/api/settings", (req, res) => {
    try {
      const settings = db.prepare("SELECT * FROM settings WHERE id = 'general'").get() as any;
      if (settings) {
        res.json(settings);
      } else {
        res.json({ id: 'general' });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", (req, res) => {
    try {
      const data = req.body;
      const existing = db.prepare("SELECT id FROM settings WHERE id = 'general'").get();
      if (existing) {
        const columns = Object.keys(data).filter(k => k !== 'id');
        const setClause = columns.map(c => `${c} = ?`).join(', ');
        const values = columns.map(c => data[c]);
        db.prepare(`UPDATE settings SET ${setClause} WHERE id = 'general'`).run(...values, 'general');
      } else {
        const columns = Object.keys(data);
        if (!columns.includes('id')) {
          columns.push('id');
          data.id = 'general';
        }
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(c => data[c]);
        db.prepare(`INSERT INTO settings (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.get("/api/projects/:projectId/lots", (req, res) => {
    try {
      const { projectId } = req.params;
      const lots = db.prepare("SELECT * FROM project_lots WHERE project_id = ?").all(projectId);
      res.json(lots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  app.post("/api/projects/:projectId/lots", (req, res) => {
    try {
      const { projectId } = req.params;
      const { id, lot_number, lot_title } = req.body;
      const lotId = id || `lot${Date.now()}`;
      db.prepare("INSERT INTO project_lots (id, project_id, lot_number, lot_title) VALUES (?, ?, ?, ?)").run(lotId, projectId, lot_number, lot_title);
      res.status(201).json({ id: lotId });
    } catch (error) {
      res.status(500).json({ error: "Failed to create lot" });
    }
  });

  app.delete("/api/lots/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM project_lots WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete lot" });
    }
  });

  // Catch-all for API routes to prevent falling through to Vite
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  // Start listening after all middleware is set up
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
