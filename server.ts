import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { proposalToXml, xmlToProposal } from "./src/lib/xmlHelper";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import https from "https";
import { createClient } from "@supabase/supabase-js";

interface GeoJSONGeometry {
  type: string;
  coordinates: any;
}

interface ZoneUrbaProperties {
  gid: number;
  partition: string;
  libelle: string;
  libelong: string;
  typezone: string;
  destdomi: string | null;
  nomfic: string;
  urlfic: string | null;
  insee: string;
  datappro: string;
  datvalid: string;
  idurba: string;
}

interface DocumentProperties {
  libelle: string;
  typedoc: string;
}

interface ApicartoPluResponse<T> {
  type: string;
  features: Array<{
    type: string;
    geometry: GeoJSONGeometry;
    properties: T;
  }>;
}

interface PluResult {
  libelle: string;
  libelong: string;
  typezone: string;
  destdomi: string | null;
  urlfic: string | null;
  datappro: string | null;
  insee: string;
  partition: string;
  document: {
    nom: string | null;
    typedoc: string | null;
  } | null;
}

/**
 * Fetch PLU data from APICARTO IGN GPU API
 */
async function getPlu(geometry: GeoJSONGeometry): Promise<PluResult> {
  try {
    const zoneUrbaUrl = "https://apicarto.ign.fr/api/gpu/zone-urba";
    console.log(`[GPU] Calling zone-urba API with geometry: ${JSON.stringify(geometry)}`);
    
    const response = await axios.get<ApicartoPluResponse<ZoneUrbaProperties>>(zoneUrbaUrl, {
      params: { geom: JSON.stringify(geometry) },
      timeout: 10000
    });

    if (!response.data.features || response.data.features.length === 0) {
      const error: any = new Error("Aucune zone PLU trouvée pour cette adresse");
      error.status = 404;
      throw error;
    }

    const props = response.data.features[0].properties;

    // Convert AAAAMMJJ to ISO string
    let datapproIso = null;
    if (props.datappro && props.datappro.length === 8) {
      const year = props.datappro.substring(0, 4);
      const month = props.datappro.substring(4, 6);
      const day = props.datappro.substring(6, 8);
      datapproIso = new Date(`${year}-${month}-${day}T00:00:00Z`).toISOString();
    }

    const result: PluResult = {
      libelle: props.libelle,
      libelong: props.libelong,
      typezone: props.typezone,
      destdomi: props.destdomi,
      urlfic: props.urlfic,
      datappro: datapproIso,
      insee: props.insee,
      partition: props.partition,
      document: null
    };

    // Optional second call for document info (non-blocking)
    try {
      const docUrl = "https://apicarto.ign.fr/api/gpu/document";
      const docResponse = await axios.get<ApicartoPluResponse<DocumentProperties>>(docUrl, {
        params: { geom: JSON.stringify(geometry) },
        timeout: 5000
      });

      if (docResponse.data.features && docResponse.data.features.length > 0) {
        const docProps = docResponse.data.features[0].properties;
        result.document = {
          nom: docProps.libelle,
          typedoc: docProps.typedoc
        };
      }
    } catch (docErr: any) {
      console.warn("[GPU] Optional document lookup failed:", docErr.message);
    }

    return result;
  } catch (error: any) {
    if (error.status === 404) throw error;
    console.error("[GPU] getPlu Error:", error.message);
    const apiError: any = new Error("Service Urbanisme (GPU) temporairement indisponible");
    apiError.status = 503;
    throw apiError;
  }
}

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

const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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

const db = new Database("/tmp/archimanager.db");

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
      ban_id_terrain TEXT,
      city_code_terrain TEXT,
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
      email TEXT UNIQUE,
      avatar TEXT,
      system_role TEXT DEFAULT 'user',
      password TEXT
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
      archived INTEGER DEFAULT 0,
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
      fee_distribution TEXT,

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
      seller_bic TEXT,
      smtpHost TEXT,
      smtpPort TEXT,
      smtpUser TEXT,
      smtpPass TEXT
    );
  `);

  // Add columns if they don't exist (for existing databases)
  const tablesToUpdate = [
    { table: 'settings', columns: ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass'] },
    { table: 'projects', columns: [
      'category', 'image_url', 'project_code', 'address', 'client_id', 'client_siret', 'client_vat_number', 'client_email', 'is_public_client', 'is_complete_mission', 'is_chantier', 'etudes_notes', 'chantier_notes', 'surface', 'construction_cost', 'remuneration', 'progression', 'project_manager', 'cotraitants', 'external_intervenants', 'entreprises',
      'reference', 'projet_detail', 'is_entreprise', 'nom_societe', 'rcs', 'representant', 'qualite', 
      'adresse_client', 'cp_client', 'ville_client', 'telephone', 'portable', 'email_client', 
      'adresse_terrain', 'cp_ville_terrain', 'ban_id_terrain', 'city_code_terrain', 'ref_cadastrale', 'zone_plu', 'surface_parcelle', 
      'nom_etablissement', 'avant_trav', 'apres_trav', 'type_et_cat', 'type_projet', 
      'categorie_projet', 'surface_plancher', 'surface_plancher_ext', 'surface_erp', 
      'surface_ert', 'effectif_public', 'effectif_personnel', 'ind', 'date_modification'
    ] },
    { table: 'milestones', columns: ['proposal_id', 'tender_id'] },
    { table: 'site_reports', columns: ['pageFormat', 'stakeholders', 'companies', 'meetingNotes', 'nextMeeting', 'meteo', 'temperature', 'effectif_total'] },
    { table: 'site_report_notes', columns: ['text', 'lot_concerne', 'photo_url', 'position', 'description', 'statut'] },
    { table: 'contacts', columns: [
      'prefix', 'middle_name', 'suffix', 'nickname', 'job_title', 'department', 
      'email_work', 'email_home', 'email_other', 
      'phone_mobile', 'phone_work', 'phone_home', 'phone_main', 'phone_fax_work', 'phone_fax_home', 'phone_pager', 'phone_other',
      'address_work_street', 'address_work_city', 'address_work_state', 'address_work_zip', 'address_work_country',
      'address_home_street', 'address_home_city', 'address_home_state', 'address_home_zip', 'address_home_country',
      'notes', 'birthday', 'category', 'company_name', 'siret', 'vat_number', 'website'
    ] },
    { table: 'team_members', columns: ['system_role', 'senderOption', 'defaultEmailTemplate', 'password'] },
    { table: 'invoices', columns: ['invoice_number', 'tax_amount', 'total_amount', 'issue_date', 'seller_name', 'seller_address', 'seller_siret', 'seller_vat_number', 'seller_iban', 'seller_bic', 'vat_rate'] },
    { table: 'tenders', columns: ['mandataire_id', 'type', 'surface', 'construction_cost', 'honoraires_percent', 'mandatory_visit', 'visit_date', 'withdrawal_deadline', 'archived'] },
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
      'ed_report_header', 'custom_building', 'custom_architect', 'custom_client', 'fee_distribution',
      'construction_cost', 'complexity_rate', 'base_fee_percent', 'exe_fee_percent', 'comp_fee_percent', 'vat_rate', 'decimal_precision'
    ] },
    { table: 'ordres_de_service', columns: [
      'march_number', 'lot', 'maitrise_oeuvre_adresse', 'entreprise', 'origine_demande',
      'montant_marche_ht', 'objet', 'date_fourniture', 'article_ccap', 'incidences_delais_type',
      'incidences_delais_details', 'incidences_couts_type', 'montant_devis_presente',
      'montant_devis_accepte', 'date_signature'
    ] },
    { table: 'ordres_de_service', columns: ['type'] },
    { table: 'reserves', columns: ['batiment', 'local', 'status', 'lots', 'entreprises', 'created_at', 'due_date', 'plan_id', 'x', 'y', 'number'] },
    { table: 'settings', columns: ['seller_iban', 'seller_bic'] },
    { table: 'settings', columns: ['zoho_client_id', 'zoho_client_secret', 'zoho_org_id', 'zoho_data_center', 'zoho_refresh_token'] },
    { table: 'invoices', columns: ['zoho_invoice_id'] }
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

  // Migrate OS type column with proper default
  try {
    db.prepare(`ALTER TABLE ordres_de_service ADD COLUMN type TEXT DEFAULT 'travaux'`).run();
  } catch (e) {
    // Column likely already exists
  }
  // Backfill type for existing rows
  db.prepare(`UPDATE ordres_de_service SET type = 'travaux' WHERE type IS NULL`).run();
  // Migrate legacy statuses to new workflow values
  db.prepare(`UPDATE ordres_de_service SET status = 'submitted' WHERE status = 'issued'`).run();
  db.prepare(`UPDATE ordres_de_service SET status = 'approved' WHERE status = 'signed'`).run();

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
  process.exit(1);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1); // trust X-Forwarded-Proto/Host from reverse proxies
  app.use('/uploads', express.static(uploadDir));
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Debug middleware for API routes
  app.use("/api/*", (req, res, next) => {
    console.log(`[API DEBUG] ${req.method} ${req.originalUrl}`);
    next();
  });

  // Supabase auth middleware — vérifie le JWT sur toutes les routes /api sauf /api/health
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const AUTH_EXEMPT = ["/api/health"];

  app.use("/api", async (req: any, res: any, next: any) => {
    if (AUTH_EXEMPT.some(p => req.originalUrl === p || req.originalUrl.startsWith(p + "/"))) {
      return next();
    }
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Authentification requise" });
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Token invalide" });
    req.user = user;
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", environment: process.env.NODE_ENV });
  });

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

  // Georisques API Interfaces
  interface RisqueEntry {
    present: boolean;
    libelle: string;
  }

  interface GeorisquesV1Response {
    risquesNaturels: Record<string, RisqueEntry>;
    risquesTechnologiques: Record<string, RisqueEntry>;
    url: string;
  }

  interface GeorisquesV2Response {
    data: Array<{
      type_risque: string;
      libelle_risque?: string;
      [key: string]: any;
    }>;
    [key: string]: any;
  }

  interface GeorisquesResult {
    url: string;
    risques_naturels: string[];
    risques_technologiques: string[];
  }

  async function getGeorisques(lon: number, lat: number, codeInsee: string): Promise<GeorisquesResult> {
    const v1Url = `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=${lon},${lat}`;
    console.log(`Attempting Georisques API v1: ${v1Url}`);

    try {
      const v1Response = await axios.get<GeorisquesV1Response>(v1Url, {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 15000 // Increased timeout
      });

      if (v1Response.data) {
        const data = v1Response.data;
        const risques_naturels = Object.values(data.risquesNaturels || {})
          .filter(r => r.present)
          .map(r => r.libelle);
        
        const risques_technologiques = Object.values(data.risquesTechnologiques || {})
          .filter(r => r.present)
          .map(r => r.libelle);

        return {
          url: data.url || `https://www.georisques.gouv.fr/mes-risques/rapport?latlon=${lon},${lat}`,
          risques_naturels,
          risques_technologiques
        };
      }
    } catch (v1Error: any) {
      console.error("Georisques API v1 failed, attempting v2 fallback:", v1Error.message);
    }

    // Fallback to API v2
    const v2Url = `https://www.georisques.gouv.fr/api/v2/indicateurs`; // Changed from /risques to /indicateurs which is more common for v2
    const token = process.env.GEORISQUES_TOKEN;
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      console.log(`Attempting Georisques API v2: ${v2Url} for lat=${lat}, lon=${lon}`);
      const v2Response = await axios.get<any>(v2Url, {
        params: {
          lat: lat,
          lng: lon,
        },
        headers,
        timeout: 8000
      });

      if (v2Response.data) {
        // Map v2 response
        const risks = v2Response.data.indicateurs || [];
        const risksList = risks.map((r: any) => r.libelle || r.nom);
        
        return {
          url: `https://www.georisques.gouv.fr/mes-risques/rapport?latlon=${lon},${lat}`,
          risques_naturels: risksList,
          risques_technologiques: []
        };
      }
    } catch (v2Error: any) {
      console.error("Georisques API v2 also failed:", v2Error.message);
    }

    throw new Error("Georisques API unavailable (v1 and v2 failed)");
  }

  app.get("/api/georisques", async (req, res) => {
    try {
      const { latitude, longitude, code_insee } = req.query;
      
      if (!latitude || !longitude || !code_insee) {
        return res.status(400).json({ error: "latitude, longitude, and code_insee are required" });
      }

      const lat = parseFloat(latitude as string);
      const lon = parseFloat(longitude as string);
      const insee = code_insee as string;

      const result = await getGeorisques(lon, lat, insee);
      res.json(result);
    } catch (error: any) {
      console.error("Error in /api/georisques:", error);
      res.status(503).json({ 
        error: "Service Géorisques temporairement indisponible", 
        details: error.message 
      });
    }
  });

  app.get("/api/urbanisme", async (req, res) => {
    try {
      const { geom } = req.query;
      if (!geom) {
        return res.status(400).json({ error: "Le paramètre 'geom' est requis (GeoJSON stringifié)" });
      }

      let geometry: GeoJSONGeometry;
      try {
        geometry = JSON.parse(geom as string);
      } catch (e) {
        return res.status(400).json({ error: "Format GeoJSON invalide" });
      }

      const result = await getPlu(geometry);
      res.json(result);
    } catch (error: any) {
      const status = error.status || 500;
      console.error(`[GPU] Route Error (${status}):`, error.message);
      res.status(status).json({ error: error.message });
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
      const {
        project_id, os_number, march_number, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      } = req.body || {};
      const id = `os-${Date.now()}`;
      db.prepare(`
        INSERT INTO ordres_de_service (
          id, project_id, os_number, march_number, title, date, description, lot, status, type,
          maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
          date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
          incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, project_id, os_number, march_number, title, date, description, lot,
        status || 'draft', type || 'travaux',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      );
      const created = db.prepare("SELECT * FROM ordres_de_service WHERE id = ?").get(id);
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating OS:", error);
      res.status(500).json({ error: "Failed to create OS", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/ordres_de_service/:id", (req, res) => {
    try {
      const { id } = req.params;
      const {
        os_number, march_number, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      } = req.body;
      db.prepare(`
        UPDATE ordres_de_service
        SET os_number = ?, march_number = ?, title = ?, date = ?, description = ?, lot = ?, status = ?, type = ?,
            maitrise_oeuvre_adresse = ?, entreprise = ?, origine_demande = ?, montant_marche_ht = ?, objet = ?,
            date_fourniture = ?, article_ccap = ?, incidences_delais_type = ?, incidences_delais_details = ?,
            incidences_couts_type = ?, montant_devis_presente = ?, montant_devis_accepte = ?, date_signature = ?
        WHERE id = ?
      `).run(
        os_number, march_number, title, date, description, lot, status, type || 'travaux',
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
      `).run(id, project_id, reception_id, title, batiment, local, status || 'A faire', JSON.stringify(lots), JSON.stringify(entreprises), created_at, due_date, plan_id, x, y, nextNumber);
      
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
      `).run(title, batiment, local, status, JSON.stringify(lots), JSON.stringify(entreprises), created_at, due_date, req.params.id);
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
      let docs;
      if (project_id) {
        docs = db.prepare("SELECT * FROM documents WHERE project_id = ?").all(project_id);
      } else {
        docs = db.prepare("SELECT * FROM documents").all();
      }
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

      const projectIdVal = project_id === '' || project_id === 'null' ? null : project_id;
      const id = `doc-${Date.now()}`;
      const file_url = `/uploads/${file.filename}`;
      
      db.prepare(`
        INSERT INTO documents (id, project_id, name, category, version, file_url, uploaded_by, uploaded_at, description)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(id, projectIdVal, name, category, file_url, uploaded_by, new Date().toISOString(), description);

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

  app.delete("/api/documents/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM document_versions WHERE document_id = ?").run(id);
      db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  app.put("/api/documents/:id", upload.single('file'), (req, res) => {
    try {
      const { id } = req.params;
      const { name, category, description, uploaded_by } = req.body;
      const file = req.file;

      if (file) {
        // Increment version and update file_url
        const doc = db.prepare("SELECT version FROM documents WHERE id = ?").get(id) as { version: number } | undefined;
        const newVersion = (doc?.version || 1) + 1;
        const file_url = `/uploads/${file.filename}`;
        
        db.prepare("UPDATE documents SET name = ?, category = ?, description = ?, version = ?, file_url = ?, uploaded_at = ? WHERE id = ?")
          .run(name, category, description, newVersion, file_url, new Date().toISOString(), id);
          
        // Add to versions table
        db.prepare(`
          INSERT INTO document_versions (id, document_id, version, file_url, uploaded_by, uploaded_at, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(`ver-${Date.now()}`, id, newVersion, file_url, uploaded_by || 'System', new Date().toISOString(), description);
      } else {
        // Just update metadata
        db.prepare("UPDATE documents SET name = ?, category = ?, description = ? WHERE id = ?")
          .run(name, category, description, id);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update document" });
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
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite, 
        adresse_client, cp_client, ville_client, telephone, portable, email_client, 
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle, 
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet, 
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp, 
        surface_ert, effectif_public, effectif_personnel, ind, date_modification
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
            surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
            reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite, 
            adresse_client, cp_client, ville_client, telephone, portable, email_client, 
            adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle, 
            nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet, 
            categorie_projet, surface_plancher, surface_plancher_ext, surface_erp, 
            surface_ert, effectif_public, effectif_personnel, ind, date_modification
          ) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          entreprises || null,
          reference || null,
          projet_detail || null,
          is_entreprise ? 1 : 0,
          nom_societe || null,
          rcs || null,
          representant || null,
          qualite || null,
          adresse_client || null,
          cp_client || null,
          ville_client || null,
          telephone || null,
          portable || null,
          email_client || null,
          adresse_terrain || null,
          cp_ville_terrain || null,
          ban_id_terrain || null,
          city_code_terrain || null,
          ref_cadastrale || null,
          zone_plu || null,
          surface_parcelle || null,
          nom_etablissement || null,
          avant_trav || null,
          apres_trav || null,
          type_et_cat || null,
          type_projet || null,
          categorie_projet || null,
          surface_plancher || null,
          surface_plancher_ext || null,
          surface_erp || null,
          surface_ert || null,
          effectif_public || null,
          effectif_personnel || null,
          ind || null,
          date_modification || null
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
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite, 
        adresse_client, cp_client, ville_client, telephone, portable, email_client, 
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle, 
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet, 
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp, 
        surface_ert, effectif_public, effectif_personnel, ind, date_modification
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
              surface = ?, construction_cost = ?, remuneration = ?, progression = ?, project_manager = ?, cotraitants = ?, external_intervenants = ?, entreprises = ?,
              reference = ?, projet_detail = ?, is_entreprise = ?, nom_societe = ?, rcs = ?, representant = ?, qualite = ?, 
              adresse_client = ?, cp_client = ?, ville_client = ?, telephone = ?, portable = ?, email_client = ?, 
              adresse_terrain = ?, cp_ville_terrain = ?, ban_id_terrain = ?, city_code_terrain = ?, ref_cadastrale = ?, zone_plu = ?, surface_parcelle = ?, 
              nom_etablissement = ?, avant_trav = ?, apres_trav = ?, type_et_cat = ?, type_projet = ?, 
              categorie_projet = ?, surface_plancher = ?, surface_plancher_ext = ?, surface_erp = ?, 
              surface_ert = ?, effectif_public = ?, effectif_personnel = ?, ind = ?, date_modification = ?
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
          reference || null,
          projet_detail || null,
          is_entreprise ? 1 : 0,
          nom_societe || null,
          rcs || null,
          representant || null,
          qualite || null,
          adresse_client || null,
          cp_client || null,
          ville_client || null,
          telephone || null,
          portable || null,
          email_client || null,
          adresse_terrain || null,
          cp_ville_terrain || null,
          ban_id_terrain || null,
          city_code_terrain || null,
          ref_cadastrale || null,
          zone_plu || null,
          surface_parcelle || null,
          nom_etablissement || null,
          avant_trav || null,
          apres_trav || null,
          type_et_cat || null,
          type_projet || null,
          categorie_projet || null,
          surface_plancher || null,
          surface_plancher_ext || null,
          surface_erp || null,
          surface_ert || null,
          effectif_public || null,
          effectif_personnel || null,
          ind || null,
          date_modification || null,
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
      const team = db.prepare("SELECT id, name, email, role, system_role, avatar FROM team_members").all();
      res.json(team);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.post("/api/team", async (req, res) => {
    try {
      const { name, email, role, system_role } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Check if user already exists
      const existing = db.prepare("SELECT * FROM team_members WHERE email = ?").get(email);
      if (existing) {
        return res.status(400).json({ error: "User with this email already exists" });
      }

      const id = `t${Date.now()}`;
      const password = Math.random().toString(36).slice(-8); // Generate random 8-char password
      
      db.prepare("INSERT INTO team_members (id, name, email, role, system_role, password) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, name, email, role || 'Member', system_role || 'user', password);

      // Send email
      let emailSent = false;
      let emailError = null;

      const settings = db.prepare("SELECT * FROM settings WHERE id = 'general'").get() as any;
      const smtpHost = settings?.smtpHost || process.env.SMTP_HOST;
      const smtpPort = settings?.smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = settings?.smtpUser || process.env.SMTP_USER;
      const smtpPass = settings?.smtpPass || process.env.SMTP_PASS;

      console.log(`[Team Creation] Attempting to send email to ${email} using host ${smtpHost}:${smtpPort}`);

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(String(smtpPort)),
            secure: String(smtpPort) === '465',
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });

          const appUrl = process.env.APP_URL || 'http://localhost:3000';
          
          await transporter.sendMail({
            from: `"ArchiManager" <${smtpUser}>`,
            to: email,
            subject: "Your ArchiManager Credentials",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #2563eb;">Welcome to ArchiManager</h2>
                <p>Hello ${name},</p>
                <p>An account has been created for you on ArchiManager. Here are your credentials to access the application:</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
                  <p style="margin: 10px 0 0 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 5px 0 0 0;"><strong>Temporary Password:</strong> ${password}</p>
                </div>
                <p>Please change your password after your first login.</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px;">Best regards,<br>The ArchiManager Team</p>
              </div>
            `
          });
          console.log(`Credentials email sent to ${email}`);
          emailSent = true;
        } catch (err: any) {
          console.error("[Team Creation] Failed to send credentials email:", err);
          emailError = err.message;
        }
      } else {
        const missing = [];
        if (!smtpHost) missing.push('smtpHost');
        if (!smtpUser) missing.push('smtpUser');
        if (!smtpPass) missing.push('smtpPass');
        console.warn(`[Team Creation] SMTP settings missing (${missing.join(', ')}), skipping credentials email.`);
        emailError = `Configuration SMTP manquante : ${missing.join(', ')}`;
      }

      res.status(201).json({ id, name, email, role, system_role, emailSent, emailError });
    } catch (error: any) {
      console.error("Error creating team member:", error);
      res.status(500).json({ error: "Failed to create team member: " + error.message });
    }
  });

  app.put("/api/team/:id/role", (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      db.prepare("UPDATE team_members SET system_role = ? WHERE id = ?").run(role, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating user role:", error);
      res.status(500).json({ error: "Failed to update role" });
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

  app.get("/api/tenders/:id", (req, res) => {
    try {
      const { id } = req.params;
      const tender = db.prepare(`
        SELECT t.*, c.first_name || ' ' || c.last_name as mandataire_name 
        FROM tenders t
        LEFT JOIN contacts c ON t.mandataire_id = c.id
        WHERE t.id = ?
      `).get(id);
      
      if (!tender) {
        return res.status(404).json({ error: "Tender not found" });
      }
      
      const specialties = db.prepare(`
        SELECT ts.*, c.first_name || ' ' || c.last_name as contact_name
        FROM tender_specialties ts
        LEFT JOIN contacts c ON ts.contact_id = c.id
        WHERE ts.tender_id = ?
      `).all(id);
      
      res.json({ ...tender, specialties_list: specialties });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tender" });
    }
  });

  app.post("/api/tenders", (req, res) => {
    try {
      const { 
        title, client, submission_deadline, status, value, notes,
        mandataire_id, type, surface, construction_cost, honoraires_percent,
        mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list
      } = req.body;
      
      const id = `t${Date.now()}`;
      
      const insertTender = db.transaction(() => {
        db.prepare(`
          INSERT INTO tenders (
            id, title, client, submission_deadline, status, value, notes,
            mandataire_id, type, surface, construction_cost, honoraires_percent,
            mandatory_visit, visit_date, withdrawal_deadline, archived
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, title, client, submission_deadline, status || 'Draft', value || 0, notes || '',
          mandataire_id || null, type || null, surface || 0, construction_cost || 0, honoraires_percent || 0,
          mandatory_visit ? 1 : 0, visit_date || null, withdrawal_deadline || null, archived ? 1 : 0
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

  app.delete("/api/tenders/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.transaction(() => {
        db.prepare("DELETE FROM tender_specialties WHERE tender_id = ?").run(id);
        db.prepare("DELETE FROM milestones WHERE tender_id = ?").run(id);
        db.prepare("DELETE FROM tenders WHERE id = ?").run(id);
      })();
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete tender" });
    }
  });

  app.put("/api/tenders/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { 
        title, client, submission_deadline, status, value, notes,
        mandataire_id, type, surface, construction_cost, honoraires_percent,
        mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list
      } = req.body;
      
      const updateTender = db.transaction(() => {
        db.prepare(`
          UPDATE tenders SET 
            title = ?, client = ?, submission_deadline = ?, status = ?, value = ?, notes = ?,
            mandataire_id = ?, type = ?, surface = ?, construction_cost = ?, honoraires_percent = ?,
            mandatory_visit = ?, visit_date = ?, withdrawal_deadline = ?, archived = ?
          WHERE id = ?
        `).run(
          title, client, submission_deadline, status, value || 0, notes || '',
          mandataire_id || null, type || null, surface || 0, construction_cost || 0, honoraires_percent || 0,
          mandatory_visit ? 1 : 0, visit_date || null, withdrawal_deadline || null, archived ? 1 : 0, id
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
    console.log("POST /api/contacts hit");
    try {
      const contact = req.body;
      console.log("Contact body:", JSON.stringify(contact));
      const sanitize = (val: any) => val === undefined ? null : val;

      const stmt = db.prepare(`
        INSERT INTO contacts (
          id, prefix, first_name, middle_name, last_name, suffix, nickname,
          company_name, job_title, department,
          email_work, email_home, email_other, email,
          phone_mobile, phone_work, market_number, market_amount_base, market_amount_options, market_amount_avenants, phone_home, phone_main, phone_fax_work, phone_fax_home, phone_pager, phone_other, phone,
          address_work_street, address_work_city, address_work_state, address_work_zip, address_work_country,
          address_home_street, address_home_city, address_home_state, address_home_zip, address_home_country,
          address, zip, city, state, country,
          candidatures, affaires, logo, ca_amount, electronic_signature, contact_references, 
          tags, category, notes, birthday, website, created_at, created_by, siret, vat_number
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        sanitize(contact.market_number),
        sanitize(contact.market_amount_base),
        sanitize(contact.market_amount_options),
        sanitize(contact.market_amount_avenants),
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
          phone_mobile = ?, phone_work = ?, market_number = ?, market_amount_base = ?, market_amount_options = ?, market_amount_avenants = ?, phone_home = ?, phone_main = ?, phone_fax_work = ?, phone_fax_home = ?, phone_pager = ?, phone_other = ?, phone = ?,
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
        sanitize(contact.market_number),
        sanitize(contact.market_amount_base),
        sanitize(contact.market_amount_options),
        sanitize(contact.market_amount_avenants),
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

  app.get("/api/contact-categories", (req, res) => {
    console.log("GET /api/contact-categories called");
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
            ed_report_header, custom_building, custom_architect, custom_client, fee_distribution
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
          p.ed_report_header, p.custom_building, p.custom_architect, p.custom_client, p.fee_distribution
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
              ed_report_header = ?, custom_building = ?, custom_architect = ?, custom_client = ?, fee_distribution = ?
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
          p.ed_report_header, p.custom_building, p.custom_architect, p.custom_client, p.fee_distribution,
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
            INSERT INTO projects (
              id, name, client, status, budget, description, start_date, end_date, address,
              reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite, 
              adresse_client, cp_client, ville_client, telephone, portable, email_client, 
              adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle, 
              nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet, 
              categorie_projet, surface_plancher, surface_plancher_ext, surface_erp, 
              surface_ert, effectif_public, effectif_personnel, ind, date_modification
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            projectId, 
            p.title, 
            client ? client.name : 'Unknown Client', 
            'Planning', 
            p.amount, 
            p.description,
            new Date().toISOString().split('T')[0],
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default 30 days
            p.adresse_terrain ? `${p.adresse_terrain}, ${p.cp_ville_terrain || ''}` : '',
            p.reference, p.projet_detail, p.is_entreprise ? 1 : 0, p.nom_societe, p.rcs, 
            p.representant, p.qualite, p.adresse_client, p.cp_client, p.ville_client, 
            p.telephone, p.portable, p.email_client, p.adresse_terrain, p.cp_ville_terrain, 
            p.ban_id_terrain, p.city_code_terrain, p.ref_cadastrale, p.zone_plu, p.surface_parcelle, 
            p.nom_etablissement, p.avant_trav, p.apres_trav, p.type_et_cat, p.type_projet, 
            p.categorie_projet, p.surface_plancher, p.surface_plancher_ext, p.surface_erp, 
            p.surface_ert, p.effectif_public, p.effectif_personnel, p.ind, p.date_modification
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
          amount || 0, description || '', status || 'Draft', due_date || null,
          invoice_number || null, tax_amount || 0, total_amount || 0, issue_date || null,
          seller_name || null, seller_address || null, seller_siret || null, seller_vat_number || null, seller_iban || null, seller_bic || null, vat_rate || 20,
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

  app.post("/api/contact-categories", (req, res) => {
    try {
      const { id, name } = req.body;
      db.prepare("INSERT INTO contact_categories (id, name) VALUES (?, ?)").run(id, name);
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create contact category" });
    }
  });

  app.delete("/api/contact-categories/:id", (req, res) => {
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
        // Try Géoplateforme API FIRST (New official IGN API)
        let url = `https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(q as string)}&limit=5`;
        console.log(`Fetching addresses from Géoplateforme for query: ${q}`);
        
        try {
          let response = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/json' }
          }, 5000);
          
          if (response.ok) {
            const geoData = await response.json();
            if (geoData.features && geoData.features.length > 0) {
              data = geoData.features.map((f: any) => ({
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
        } catch (e) {
          console.warn("Géoplateforme API failed, trying BAN fallback");
        }

        // Fallback to api-adresse.data.gouv.fr if Géoplateforme returned nothing
        if (!data || (Array.isArray(data) && data.length === 0)) {
          url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q as string)}&limit=5`;
          console.log(`Géoplateforme returned no results, trying BAN for query: ${q}`);
          
          try {
            let response = await fetchWithTimeout(url, {
              headers: { 'Accept': 'application/json' }
            }, 5000);
            
            if (response.ok) {
              const banData = await response.json();
              if (banData.features && banData.features.length > 0) {
                data = banData.features.map((f: any) => ({
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
          } catch (e) {
            console.warn("BAN API also failed, trying BDNB fallback");
          }
        }

        // Final fallback to BDNB geocoder
        if (!data || (Array.isArray(data) && data.length === 0)) {
          url = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=5`;
          console.log(`BAN returned no results, trying BDNB for query: ${q}`);
          
          try {
            let response = await fetchWithTimeout(url, {
              headers: { 'Accept': 'application/json' }
            }, 15000);
            
            if (response.ok) {
              const text = await response.text();
              data = JSON.parse(text);
            }
          } catch (e) {
            console.warn("BDNB geocoder also failed");
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

  app.get("/api/weather", async (req, res) => {
    try {
      const { q, date } = req.query;
      if (!q || !date) {
        return res.status(400).json({ error: "Address and date are required" });
      }

      // 1. Geocode address
      const geocodeUrl = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q as string)}&limit=1`;
      const geoRes = await fetchWithTimeout(geocodeUrl, {}, 5000);
      if (!geoRes.ok) {
        throw new Error("Geocoding failed");
      }
      const geoData = await geoRes.json();
      if (!geoData.features || geoData.features.length === 0) {
        return res.status(404).json({ error: "Address not found" });
      }

      const [lon, lat] = geoData.features[0].geometry.coordinates;

      // 2. Fetch weather from Open-Meteo
      // We use the forecast API which also handles recent history (up to 92 days)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max&timezone=auto&start_date=${date}&end_date=${date}`;
      
      const weatherRes = await fetchWithTimeout(weatherUrl, {}, 5000);
      if (!weatherRes.ok) {
        // If forecast API fails (maybe date is too far in the past), try archive API
        const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max&timezone=auto&start_date=${date}&end_date=${date}`;
        const archiveRes = await fetchWithTimeout(archiveUrl, {}, 5000);
        if (!archiveRes.ok) {
          throw new Error("Weather API failed");
        }
        const archiveData = await archiveRes.json();
        return res.json(formatWeatherData(archiveData));
      }

      const weatherData = await weatherRes.json();
      res.json(formatWeatherData(weatherData));
    } catch (error: any) {
      console.error("Error in /api/weather:", error);
      res.status(500).json({ error: "Failed to fetch weather data" });
    }
  });

  function formatWeatherData(data: any) {
    if (!data.daily || !data.daily.weather_code || data.daily.weather_code.length === 0) {
      return { meteo: "Inconnu", temperature: null };
    }

    const code = data.daily.weather_code[0];
    const temp = data.daily.temperature_2m_max[0];

    const weatherMap: Record<number, string> = {
      0: "Ciel dégagé",
      1: "Principalement dégagé",
      2: "Partiellement nuageux",
      3: "Couvert",
      45: "Brouillard",
      48: "Brouillard givrant",
      51: "Bruine légère",
      53: "Bruine modérée",
      55: "Bruine dense",
      61: "Pluie faible",
      63: "Pluie modérée",
      65: "Pluie forte",
      71: "Neige faible",
      73: "Neige modérée",
      75: "Neige forte",
      80: "Averses de pluie faibles",
      81: "Averses de pluie modérées",
      82: "Averses de pluie violentes",
      95: "Orage",
    };

    return {
      meteo: weatherMap[code] || "Variable",
      temperature: temp
    };
  }

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
      const { lat: latQuery, lon: lonQuery, distance = 1000 } = req.query;
      if (!latQuery || !lonQuery) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const lat = parseFloat(latQuery as string);
      const lon = parseFloat(lonQuery as string);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: "Invalid latitude or longitude" });
      }

      const dataset = "liste-des-immeubles-proteges-au-titre-des-monuments-historiques";
      const url = `https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/${dataset}/records`;

      // ÉTAPE 1 : appel sans select ni where géo — juste 1 record pour voir les vrais noms
      console.log(`[Culture] Découverte des champs sur dataset...`);
      const discoveryResponse = await axios.get(url, {
        params: {
          limit: 1,
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 10000
      });

      if (discoveryResponse.data?.results?.length > 0) {
        const sample = discoveryResponse.data.results[0];
        console.log("[Culture] === VRAIS NOMS DE CHAMPS ===");
        Object.entries(sample).forEach(([k, v]) => {
          console.log(`  "${k}": ${JSON.stringify(v)?.substring(0, 60)}`);
        });
        console.log("[Culture] === FIN CHAMPS ===");
      }

      // ÉTAPE 2 : appel géographique AVEC where explicite
      console.log(`[Culture] Requête géo: lat=${lat}, lon=${lon}, distance=${distance}m`);

      const response = await axios.get(url, {
        params: {
          limit: 10,
          select: `*, distance(coordonnees_au_format_wgs84, geom'POINT(${lon} ${lat})') as dist`,
          where: `within_distance(coordonnees_au_format_wgs84, geom'POINT(${lon} ${lat})', ${distance}m)`,
          order_by: `distance(coordonnees_au_format_wgs84, geom'POINT(${lon} ${lat})')`
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 15000
      });

      const v2Data = response.data;

      if (!v2Data?.results) {
        return res.json({ records: [] });
      }

      console.log(`[Culture] ${v2Data.results.length} monument(s) trouvé(s)`);
      if (v2Data.results.length > 0) {
        console.log("[Culture] Champs du 1er résultat:", Object.keys(v2Data.results[0]));
      }

      // Mapping défensif : on prend ce qui existe, peu importe le nom exact
      const mappedData = {
        records: v2Data.results.map((r: any) => {
          // Cherche le champ geo — peut s'appeler coordonnees_au_format_wgs84, coordonnees_ban, geolocalisation, etc.
          const geoField = r.coordonnees_au_format_wgs84 ?? r.coordonnees_ban ?? r.geolocalisation ?? r.coordonnees_gps ?? null;
          
          // Cherche la référence Mérimée
          const refField = r.ref ?? r.reference ?? r.ref_merimee ?? null;
          
          return {
            recordid: refField || `mh-${Math.random().toString(36).substr(2, 9)}`,
            fields: {
              ref_merimee: refField,
              tico: r.tico ?? r.titre_courant ?? r.denomination_de_l_edifice ?? null,
              comm: r.com ?? r.commune ?? r.commune_forme_index ?? null,
              dpt: r.dpt_lettre ?? r.departement ?? r.dep ?? null,
              stat: r.stat ?? r.statut_juridique_de_l_edifice ?? null,
              prec_lib: r.ppro ?? r.precision_sur_la_protection ?? null,
              dpro: r.dpro ?? r.date_et_typologie_de_la_protection ?? null,
              autr: r.autr ?? r.auteur_de_l_edifice ?? null,
              adrs: r.adrs ?? r.adresse_forme_index ?? null,
              coordonnees_ban: geoField,
              dist: r.dist ?? null,
            }
          };
        })
      };

      res.json(mappedData);

    } catch (error: any) {
      if (error.response) {
        console.error(
          "[Culture] API Error:",
          error.response.status,
          JSON.stringify(error.response.data).substring(0, 400)
        );
        return res.status(error.response.status).json({
          error: `Culture API error: ${error.response.status}`,
          details: error.response.data?.message || error.response.data
        });
      }
      console.error("[Culture] Proxy Error:", error.message);
      res.status(error.code === 'ECONNABORTED' ? 504 : 500).json({
        error: error.code === 'ECONNABORTED' ? "Culture API request timed out" : "Internal server error",
        details: error.message
      });
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

      const smtpHost = settings.smtpHost || process.env.SMTP_HOST;
      const smtpPort = settings.smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = settings.smtpUser || process.env.SMTP_USER;
      const smtpPass = settings.smtpPass || process.env.SMTP_PASS;

      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(500).json({ error: "Configuration SMTP manquante" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort)),
        secure: String(smtpPort) === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass,
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
      const validColumns = ['agencyName', 'address', 'phone', 'email', 'siret', 'vatNumber', 'currency', 'language', 'senderOption', 'defaultEmailTemplate', 'logoUrl', 'seller_iban', 'seller_bic', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'zoho_client_id', 'zoho_client_secret', 'zoho_org_id', 'zoho_data_center'];
      const filteredData = Object.keys(data)
        .filter(k => validColumns.includes(k))
        .reduce((obj, key) => {
          obj[key] = data[key];
          return obj;
        }, {} as any);

      const existing = db.prepare("SELECT id FROM settings WHERE id = 'general'").get();
      if (existing) {
        const columns = Object.keys(filteredData);
        if (columns.length === 0) {
          res.json({ success: true });
          return;
        }
        const setClause = columns.map(c => `${c} = ?`).join(', ');
        const values = columns.map(c => filteredData[c]);
        db.prepare(`UPDATE settings SET ${setClause} WHERE id = 'general'`).run(...values);
      } else {
        const columns = Object.keys(filteredData);
        if (!columns.includes('id')) {
          columns.push('id');
          filteredData.id = 'general';
        }
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map(c => filteredData[c]);
        db.prepare(`INSERT INTO settings (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.post("/api/test-smtp", async (req, res) => {
    try {
      const { smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
      
      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(400).json({ error: "Missing SMTP configuration" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort) || '587'),
        secure: String(smtpPort) === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: `"ArchiManager Test" <${smtpUser}>`,
        to: smtpUser,
        subject: "ArchiManager SMTP Test",
        text: "This is a test email from ArchiManager to verify your SMTP configuration.",
        html: "<b>This is a test email from ArchiManager to verify your SMTP configuration.</b>"
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("SMTP Test Error:", error);
      res.status(500).json({ error: error.message });
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

  // ─── Zoho Invoice Integration ──────────────────────────────────────────────

  let zohoAccessTokenCache: { token: string; expiresAt: number } | null = null;

  async function getZohoAccessToken(settings: any): Promise<string> {
    const now = Date.now();
    if (zohoAccessTokenCache && zohoAccessTokenCache.expiresAt > now + 60000) {
      return zohoAccessTokenCache.token;
    }
    const dc = settings.zoho_data_center || 'com';
    const params = new URLSearchParams({
      refresh_token: settings.zoho_refresh_token,
      client_id: settings.zoho_client_id,
      client_secret: settings.zoho_client_secret,
      grant_type: 'refresh_token',
    });
    const resp = await axios.post(
      `https://accounts.zoho.${dc}/oauth/v2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token, expires_in } = resp.data;
    if (!access_token) throw new Error('Zoho token refresh failed: ' + JSON.stringify(resp.data));
    zohoAccessTokenCache = { token: access_token, expiresAt: now + (expires_in || 3600) * 1000 };
    return access_token;
  }

  async function getOrCreateZohoCustomer(apiBase: string, headers: any, name: string): Promise<string> {
    try {
      const search = await axios.get(`${apiBase}/contacts`, {
        headers,
        params: { contact_name_contains: name, per_page: 5 }
      });
      const contacts: any[] = search.data.contacts || [];
      if (contacts.length > 0) return contacts[0].contact_id;
    } catch (_) {}
    const create = await axios.post(`${apiBase}/contacts`, {
      contact_name: name,
      contact_type: 'customer'
    }, { headers });
    return create.data.contact.contact_id;
  }

  function mapZohoStatus(zohoStatus: string): string | null {
    const map: Record<string, string> = {
      draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', void: 'Draft'
    };
    return map[zohoStatus] ?? null;
  }

  // GET /api/zoho/status
  app.get('/api/zoho/status', (req, res) => {
    try {
      const settings = db.prepare("SELECT zoho_client_id, zoho_org_id, zoho_data_center, zoho_refresh_token FROM settings WHERE id = 'general'").get() as any;
      res.json({
        connected: !!(settings?.zoho_refresh_token),
        has_credentials: !!(settings?.zoho_client_id && settings?.zoho_client_secret && settings?.zoho_org_id),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get Zoho status' });
    }
  });

  function getZohoRedirectUri(req: any): string {
    // ZOHO_REDIRECT_URI env var wins — lets the admin hardcode the exact registered URI
    if (process.env.ZOHO_REDIRECT_URI) return process.env.ZOHO_REDIRECT_URI;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host  = req.headers['x-forwarded-host']  || req.get('host');
    return `${proto}://${host}/api/zoho/callback`;
  }

  // GET /api/zoho/callback-url  — returns the redirect URI the server will actually use
  app.get('/api/zoho/callback-url', (req, res) => {
    res.json({ url: getZohoRedirectUri(req) });
  });

  // GET /api/zoho/auth  — redirects browser to Zoho OAuth consent screen
  app.get('/api/zoho/auth', (req, res) => {
    try {
      const settings = db.prepare("SELECT * FROM settings WHERE id = 'general'").get() as any;
      if (!settings?.zoho_client_id || !settings?.zoho_client_secret || !settings?.zoho_org_id) {
        return res.status(400).send('Veuillez d\'abord enregistrer vos identifiants Zoho dans les Paramètres.');
      }
      const dc = settings.zoho_data_center || 'com';
      const redirectUri = getZohoRedirectUri(req);
      const scope = 'ZohoInvoice.invoices.READ,ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.UPDATE,ZohoInvoice.contacts.READ,ZohoInvoice.contacts.CREATE';
      const authUrl = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
      authUrl.searchParams.set('client_id', settings.zoho_client_id);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      res.redirect(authUrl.toString());
    } catch (error) {
      res.status(500).send('Erreur lors de la connexion à Zoho');
    }
  });

  // GET /api/zoho/callback  — Zoho redirects here after user grants access
  app.get('/api/zoho/callback', async (req, res) => {
    const { code, error: oauthError } = req.query as any;
    if (oauthError || !code) {
      return res.redirect('/settings?zoho_error=1');
    }
    try {
      const settings = db.prepare("SELECT * FROM settings WHERE id = 'general'").get() as any;
      const dc = settings.zoho_data_center || 'com';
      const redirectUri = getZohoRedirectUri(req);
      const params = new URLSearchParams({
        code,
        client_id: settings.zoho_client_id,
        client_secret: settings.zoho_client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      const resp = await axios.post(
        `https://accounts.zoho.${dc}/oauth/v2/token`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const { refresh_token } = resp.data;
      if (!refresh_token) throw new Error('No refresh_token in response');
      zohoAccessTokenCache = null; // invalidate cache
      db.prepare("UPDATE settings SET zoho_refresh_token = ? WHERE id = 'general'").run(refresh_token);
      res.redirect('/settings?zoho_connected=1');
    } catch (error: any) {
      console.error('[Zoho callback error]', error.message);
      res.redirect('/settings?zoho_error=1');
    }
  });

  // DELETE /api/zoho/disconnect
  app.delete('/api/zoho/disconnect', (req, res) => {
    try {
      zohoAccessTokenCache = null;
      db.prepare("UPDATE settings SET zoho_refresh_token = NULL WHERE id = 'general'").run();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to disconnect Zoho' });
    }
  });

  // POST /api/zoho/sync  — bidirectional sync
  app.post('/api/zoho/sync', async (req, res) => {
    try {
      const settings = db.prepare("SELECT * FROM settings WHERE id = 'general'").get() as any;
      if (!settings?.zoho_refresh_token) {
        return res.status(400).json({ error: 'Zoho non connecté. Veuillez vous connecter dans les Paramètres.' });
      }

      const accessToken = await getZohoAccessToken(settings);
      const dc = settings.zoho_data_center || 'com';
      const apiBase = `https://invoice.zoho.${dc}/api/v3`;
      const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'X-com-zoho-invoice-organizationid': settings.zoho_org_id,
        'Content-Type': 'application/json',
      };

      const errors: string[] = [];
      let pushed = 0;
      let pulled = 0;

      // 1. Push local invoices not yet in Zoho
      const localInvoices = db.prepare(`
        SELECT i.*, p.name as project_name
        FROM invoices i LEFT JOIN projects p ON i.project_id = p.id
        WHERE i.zoho_invoice_id IS NULL OR i.zoho_invoice_id = ''
      `).all() as any[];

      for (const inv of localInvoices) {
        try {
          const customerName = inv.project_name || inv.description || 'Client';
          const customerId = await getOrCreateZohoCustomer(apiBase, headers, customerName);
          const lineItems = (inv.items && inv.items.length)
            ? inv.items.map((item: any) => ({
                description: item.description,
                quantity: item.quantity || 1,
                rate: item.unit_price ?? item.amount ?? 0,
                tax_percentage: item.vat_rate || 0,
              }))
            : [{
                description: inv.description || 'Honoraires',
                quantity: 1,
                rate: inv.amount || 0,
                tax_percentage: inv.vat_rate || 0,
              }];

          const payload: any = {
            customer_id: customerId,
            date: (inv.issue_date || new Date().toISOString()).split('T')[0],
            due_date: inv.due_date ? inv.due_date.split('T')[0] : undefined,
            line_items: lineItems,
            notes: inv.description || undefined,
          };
          if (inv.invoice_number) payload.invoice_number = inv.invoice_number;

          const resp = await axios.post(`${apiBase}/invoices`, payload, { headers });
          const zohoId = resp.data?.invoice?.invoice_id;
          if (zohoId) {
            db.prepare("UPDATE invoices SET zoho_invoice_id = ? WHERE id = ?").run(zohoId, inv.id);
            pushed++;
          }
        } catch (err: any) {
          errors.push(`Envoi échoué (${inv.invoice_number || inv.id}): ${err.response?.data?.message || err.message}`);
        }
      }

      // 2. Pull status updates from Zoho
      try {
        const resp = await axios.get(`${apiBase}/invoices`, { headers, params: { per_page: 200 } });
        const zohoInvoices: any[] = resp.data?.invoices || [];
        for (const zohoInv of zohoInvoices) {
          const local = db.prepare("SELECT id, status FROM invoices WHERE zoho_invoice_id = ?").get(zohoInv.invoice_id) as any;
          if (local) {
            const newStatus = mapZohoStatus(zohoInv.status);
            if (newStatus && newStatus !== local.status) {
              db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(newStatus, local.id);
              pulled++;
            }
          }
        }
      } catch (err: any) {
        errors.push(`Récupération échouée: ${err.response?.data?.message || err.message}`);
      }

      res.json({ pushed, pulled, errors });
    } catch (error: any) {
      console.error('[Zoho sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });

  // ─── End Zoho Invoice Integration ──────────────────────────────────────────

  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  // Vite middleware for development
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom", // Disable Vite's own SPA fallback
    });
    app.use(vite.middlewares);

    // Custom SPA fallback for dev
    app.use("*", async (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send("Not found");
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });

  } else {
    // Production serving
    app.use(express.static(distPath));

    // Specifically handle missing assets (like CSS, JS, etc.) to avoid sending index.html and causing loops
    app.use((req, res, next) => {
      // If request has a file extension, do not fall back to index.html
      if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send("Not found");
      }
      next();
    });

    // SPA fallback for production
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Start listening after all middleware is set up
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
