import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { proposalToXml, xmlToProposal } from "./src/lib/xmlHelper";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import https from "https";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/node";

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
    let datapproIso: string | null = null;
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

// Memory storage — files are held in req.file.buffer, uploaded to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

// Keep /tmp/uploads only as a static fallback for legacy URLs already in the DB
const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

dotenv.config();

/* SQLite initialization removed — using Supabase PostgreSQL */
if (false as any) {
  const db: any = null; // stub to satisfy TypeScript inside dead-code block
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

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      lot_id TEXT,
      contact_id TEXT,
      texte TEXT NOT NULL DEFAULT '',
      statut TEXT NOT NULL DEFAULT 'À faire',
      due_date TEXT,
      created_report_id TEXT,
      resolved_report_id TEXT,
      number INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(created_report_id) REFERENCES site_reports(id),
      FOREIGN KEY(resolved_report_id) REFERENCES site_reports(id)
    );

    CREATE TABLE IF NOT EXISTS observation_reports (
      observation_id TEXT,
      report_id TEXT,
      PRIMARY KEY (observation_id, report_id),
      FOREIGN KEY(observation_id) REFERENCES observations(id) ON DELETE CASCADE,
      FOREIGN KEY(report_id) REFERENCES site_reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      phase TEXT,
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

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      user_id TEXT,
      user_name TEXT,
      action TEXT NOT NULL,
      target TEXT,
      target_id TEXT,
      target_type TEXT,
      category TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS feed_posts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      user_id TEXT,
      user_name TEXT,
      content TEXT NOT NULL,
      created_at TEXT,
      likes_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS feed_comments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      post_id TEXT,
      user_id TEXT,
      user_name TEXT,
      content TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS feed_likes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      item_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT,
      proposal_id TEXT,
      tender_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meeting_photos (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      file_url TEXT NOT NULL,
      caption TEXT,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id)
    );

    CREATE TABLE IF NOT EXISTS meeting_attendees (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      role TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
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
      'construction_cost', 'ratio_rehab', 'ratio_extension', 'complexity_rate', 'base_fee_percent', 'exe_fee_percent', 'comp_fee_percent', 'vat_rate', 'decimal_precision'
    ] },
    { table: 'ordres_de_service', columns: [
      'march_number', 'lot', 'maitrise_oeuvre_adresse', 'entreprise', 'origine_demande',
      'montant_marche_ht', 'objet', 'date_fourniture', 'article_ccap', 'incidences_delais_type',
      'incidences_delais_details', 'incidences_couts_type', 'montant_devis_presente',
      'montant_devis_accepte', 'date_signature'
    ] },
    { table: 'ordres_de_service', columns: ['type'] },
    { table: 'reserves', columns: ['batiment', 'local', 'status', 'lots', 'entreprises', 'created_at', 'due_date', 'plan_id', 'x', 'y', 'number'] },
    { table: 'observations', columns: ['lot_id', 'contact_id', 'texte', 'statut', 'due_date', 'created_report_id', 'resolved_report_id', 'number', 'created_at'] },
    { table: 'observation_reports', columns: ['observation_id', 'report_id'] },
    { table: 'settings', columns: ['seller_iban', 'seller_bic'] },
    { table: 'settings', columns: ['zoho_client_id', 'zoho_client_secret', 'zoho_org_id', 'zoho_data_center', 'zoho_refresh_token', 'zoho_books_org_id'] },
    { table: 'invoices', columns: ['zoho_invoice_id'] },
    { table: 'invoices', columns: ['invoice_type'] },
    { table: 'invoices', columns: ['mission_id', 'mission_name'] },
    { table: 'activities', columns: ['likes_count'] },
    { table: 'team_members', columns: ['notifications_last_seen'] },
    { table: 'meetings', columns: ['proposal_id', 'tender_id'] }
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
    db.prepare(`ALTER TABLE invoices ADD COLUMN advancement_pct NUMERIC DEFAULT 0`).run();
  } catch (e) {
    // Column likely already exists
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

}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1); // trust X-Forwarded-Proto/Host from reverse proxies

  // CORS headers — must run before any redirect so that redirect responses also
  // carry Access-Control-Allow-Origin (browsers check CORS on redirect responses too).
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Redirect HTTP → HTTPS so the HTML page and all its assets share the same origin.
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    // Canonicalize bare apex → www so all assets and the HTML share the same origin.
    // Only the exact apex domain is redirected — tenant subdomains (e.g.
    // aacz.archioffice.fr) and www itself must pass through untouched.
    const host = req.headers.host || '';
    if (host === 'archioffice.fr') {
      return res.redirect(301, `https://www.archioffice.fr${req.url}`);
    }
    next();
  });


  // Serve legacy /uploads/ files (existing DB rows that still point to /tmp paths)
  app.use('/uploads', express.static(uploadDir));
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Offline desktop mode: SUPABASE_URL points back at this same server, so
  // supabaseAdmin's .from()/.auth/.storage calls loop back here instead of
  // reaching the real Supabase — see the offline-mode plan for why this is
  // additive only and never touches the routes/helpers below.
  if (process.env.OFFLINE_MODE === 'true') {
    const { createOfflineGateway } = await import('./server/offlineGateway');
    app.use(createOfflineGateway({
      postgrestUrl: process.env.OFFLINE_POSTGREST_URL || 'http://127.0.0.1:5555',
      pgUrl: process.env.OFFLINE_PG_URL,
    }));
  }

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

  // Ensure Supabase Storage buckets exist at startup (after supabaseAdmin is initialized).
  // In offline mode this call loops back into this same server's /storage/v1 shim
  // (see server/offlineGateway.ts), so it must wait until app.listen() below is
  // actually accepting connections — otherwise the loopback request fails outright.
  if (process.env.OFFLINE_MODE !== 'true') {
    await ensureStorageBuckets();
  } else {
    // Application-level local login (distinct from the /auth/v1 shim, which only
    // satisfies supabaseAdmin's own internal calls) — see server/localAuthRoutes.ts.
    const { createLocalAuthRouter } = await import('./server/localAuthRoutes');
    app.use('/api/auth', createLocalAuthRouter(supabaseAdmin));

    // First-run "log into your existing cloud account" flow — see
    // server/cloudLinkRoutes.ts. Mounted alongside local-auth (a first-run
    // install picks one or the other, both routers coexist harmlessly).
    const { createCloudLinkRouter } = await import('./server/cloudLinkRoutes');
    app.use('/api/auth', createCloudLinkRouter(supabaseAdmin));

    // If already linked, start the background sync engine (server/cloudSync.ts).
    const { readCloudLinkState } = await import('./server/cloudLinkState');
    const linkState = readCloudLinkState();
    if (linkState?.importCompleted) {
      try {
        const { startCloudSync } = await import('./server/cloudSync');
        const { createCloudSyncRouter } = await import('./server/cloudSyncRoutes');
        const cloudSync = await startCloudSync(supabaseAdmin, linkState);
        app.use('/api/sync', createCloudSyncRouter(cloudSync));
      } catch (err: any) {
        // A cloud-sync startup failure (e.g. the stored refresh token is no
        // longer valid, or the machine is offline right now) shouldn't take
        // the whole app down — the install still works fully offline
        // against its local data either way; sync just won't run this session.
        console.error('[cloudSync] Failed to start background sync:', err.message);
      }
    }
  }

  // Résolution tenant_id depuis profiles (mis en cache par request).
  // N'auto-provisionne plus de tenant "fantôme" : un compte sans agence doit
  // passer par /api/agency-setup (créer ou rejoindre une agence) — voir
  // src/pages/AgencySetup.tsx et la garde dans ProtectedLayout (src/App.tsx).
  async function getTenantId(userId: string): Promise<string> {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id')
      .eq('id', userId)
      .single();

    if (data?.tenant_id) return data.tenant_id;

    const err: any = new Error("Ce compte n'est rattaché à aucune agence. Veuillez d'abord créer ou rejoindre une agence.");
    err.status = 409;
    err.code = 'NO_TENANT';
    throw err;
  }

  // ─── Billing / Plan quota ──────────────────────────────────────────────────

  const PLAN_LIMITS: Record<string, { projects: number; users: number; documents: number }> = {
    trial:      { projects: 3,   users: 1,   documents: 10  },
    starter:    { projects: 10,  users: 2,   documents: 100 },
    pro:        { projects: 999, users: 10,  documents: 999 },
    enterprise: { projects: 999, users: 999, documents: 999 },
    expired:    { projects: 0,   users: 0,   documents: 0   },
  };

  // ─── AI Token Pricing ────────────────────────────────────────────────────────
  // Recalibrated for the gemini-3-flash-preview migration (see server.ts's
  // genai.models.generateContent call and archioffice-agents' chat route).
  // gemini-2.5-flash cost Google $0.30/M input; the old €0.40 default was a
  // ~1.333x markup on that. gemini-3-flash-preview costs $0.50/$3.00 per M
  // input/output — both prices below apply that same ~1.333x markup to the
  // new cost (output used to run at a ~0.66x markup, i.e. below cost,
  // subsidized by the input side; now deliberately unsubsidized, same factor
  // on both).
  const AI_PRICE_EUR_PER_M_INPUT  = parseFloat(process.env.AI_PRICE_INPUT_PER_M  || '0.67');
  const AI_PRICE_EUR_PER_M_OUTPUT = parseFloat(process.env.AI_PRICE_OUTPUT_PER_M || '4.00');

  function calcCostEurCents(inputTokens: number, outputTokens: number): number {
    const cost = (inputTokens / 1_000_000) * AI_PRICE_EUR_PER_M_INPUT
               + (outputTokens / 1_000_000) * AI_PRICE_EUR_PER_M_OUTPUT;
    return Math.max(1, Math.ceil(cost * 100));
  }

  // Monthly AI credit included per plan (EUR cents). Topped up once per month.
  const PLAN_AI_MONTHLY_CREDIT_CENTS: Record<string, number> = {
    trial: 0, starter: 50, pro: 200, enterprise: 1000,
  };

  // Prepaid credit packs
  const AI_CREDIT_PACKS: Record<string, { amount_cents: number; label: string }> = {
    pack_10: { amount_cents: 1000, label: '10 €' },
    pack_25: { amount_cents: 2500, label: '25 €' },
    pack_50: { amount_cents: 5000, label: '50 €' },
  };

  // Top up plan monthly allowance on first AI call of each month
  async function maybeRefreshMonthlyCredits(tenantId: string, plan: string): Promise<void> {
    const included = PLAN_AI_MONTHLY_CREDIT_CENTS[plan] ?? 0;
    const { data: tenant } = await supabaseAdmin.from('tenants')
      .select('ai_credit_last_refresh').eq('id', tenantId).single();
    const lastRefresh = (tenant as any)?.ai_credit_last_refresh;
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    if (!lastRefresh || lastRefresh < firstOfMonth) {
      if (included > 0) {
        await supabaseAdmin.rpc('increment_ai_credits', { p_tenant_id: tenantId, p_amount_cents: included });
      }
      await supabaseAdmin.from('tenants')
        .update({ ai_credit_last_refresh: new Date().toISOString() }).eq('id', tenantId);
    }
  }

  // Deduct cost from tenant balance and log usage
  async function deductAiCredit(params: {
    tenantId: string; userId: string;
    agentId: string | null; conversationId: string | null;
    endpointType: 'agent' | 'suggest_articles';
    inputTokens: number; outputTokens: number;
  }): Promise<{ newBalance: number; costCents: number }> {
    const costCents = calcCostEurCents(params.inputTokens, params.outputTokens);
    await supabaseAdmin.rpc('deduct_ai_credits', { p_tenant_id: params.tenantId, p_amount_cents: costCents });
    const { data: t } = await supabaseAdmin.from('tenants')
      .select('ai_credit_balance_eur_cents').eq('id', params.tenantId).single();
    const newBalance = (t as any)?.ai_credit_balance_eur_cents ?? 0;
    await supabaseAdmin.from('agent_token_usage').insert({
      tenant_id: params.tenantId, agent_id: params.agentId,
      user_id: params.userId, conversation_id: params.conversationId,
      tokens_used: params.inputTokens + params.outputTokens,
      input_tokens: params.inputTokens, output_tokens: params.outputTokens,
      cost_eur_cents: costCents, endpoint_type: params.endpointType,
    });
    return { newBalance, costCents };
  }

  async function getTenantPlan(tenantId: string): Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }> {
    const { data } = await supabaseAdmin.from('tenants').select('plan, trial_ends_at').eq('id', tenantId).single();
    if (!data) return { plan: 'trial', trial_ends_at: null, is_expired: false };
    const isTrial = (data as any).plan === 'trial';
    const isExpired = isTrial && (data as any).trial_ends_at && new Date((data as any).trial_ends_at) < new Date();
    return {
      plan: isExpired ? 'expired' : (data as any).plan,
      trial_ends_at: (data as any).trial_ends_at ?? null,
      is_expired: !!isExpired,
    };
  }

  async function checkQuota(tenantId: string, resource: 'projects' | 'users' | 'documents'): Promise<void> {
    const { plan, is_expired } = await getTenantPlan(tenantId);
    if (is_expired) {
      const err: any = new Error("Votre période d'essai a expiré. Veuillez souscrire à un abonnement.");
      err.status = 402;
      throw err;
    }
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.trial;
    const limit = limits[resource];
    if (limit >= 999) return;
    let count = 0;
    if (resource === 'projects') {
      const { count: c } = await supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      count = c ?? 0;
    } else if (resource === 'users') {
      const { count: c } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      count = c ?? 0;
    } else if (resource === 'documents') {
      const { count: c } = await supabaseAdmin.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      count = c ?? 0;
    }
    if (count >= limit) {
      const err: any = new Error(`Limite du plan atteinte : ${limit} ${resource}. Passez à un plan supérieur.`);
      err.status = 402;
      throw err;
    }
  }

  // ─── Supabase Storage helpers ───────────────────────────────────────────────

  async function ensureStorageBuckets() {
    for (const bucket of ['documents', 'cv', 'message-attachments', 'feed-attachments']) {
      const { data: existing } = await supabaseAdmin.storage.getBucket(bucket);
      if (!existing) {
        const { error } = await supabaseAdmin.storage.createBucket(bucket, { public: true, fileSizeLimit: 52428800 });
        if (error && !error.message.includes('already exists')) {
          console.error(`[storage] Failed to create bucket "${bucket}":`, error.message);
        } else {
          console.log(`[storage] Created bucket "${bucket}"`);
        }
      }
    }
  }

  async function uploadToStorage(bucket: string, storagePath: string, buffer: Buffer, mimetype: string): Promise<string> {
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, { contentType: mimetype, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  async function deleteFromStorage(bucket: string, fileUrl: string) {
    const marker = `/object/public/${bucket}/`;
    const path = fileUrl.includes(marker) ? fileUrl.split(marker)[1] : fileUrl;
    await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => {});
  }

  // ───────────────────────────────────────────────────────────────────────────

  // The local-auth routes are only ever registered when OFFLINE_MODE=true (see
  // above), so these entries are inert in the normal cloud deployment.
  const AUTH_EXEMPT = [
    "/api/health", "/api/public", "/api/billing/webhook",
    "/api/auth/local-status", "/api/auth/local-setup", "/api/auth/local-login",
    "/api/auth/cloud-link-status", "/api/auth/cloud-link", "/api/auth/cloud-link-import",
  ];

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

  // ── Google OAuth2 token exchange (public — no JWT required) ─────────────
  app.post("/api/auth/google/token", async (req: any, res: any) => {
    try {
      const { code, code_verifier, redirect_uri } = req.body;
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId) return res.status(503).json({ error: "VITE_GOOGLE_CLIENT_ID non configuré" });
      if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: "code, code_verifier et redirect_uri requis" });
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          code_verifier,
          redirect_uri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        return res.status(400).json({ error: err.error_description || 'Échec de l\'échange de code' });
      }

      const tokenData = await tokenRes.json();
      res.json({ access_token: tokenData.access_token });
    } catch (error: any) {
      console.error('Google token exchange error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Best-effort platform-level SMTP send (used before a tenant exists, so tenant
  // settings' own SMTP config isn't available yet). Returns whether it was sent.
  async function sendPlatformMail(to: string, subject: string, html: string): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn('[mail] SMTP_HOST/SMTP_USER/SMTP_PASS not configured — email not sent.');
      return false;
    }
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(process.env.SMTP_PORT || '587')),
        secure: String(process.env.SMTP_PORT) === '465',
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({ from: `"ArchiOffice" <${smtpUser}>`, to, subject, html });
      return true;
    } catch (err: any) {
      console.error('[mail] Send failed:', err.message);
      return false;
    }
  }

  // ---- Inscription SaaS (route publique) ----
  app.post("/api/public/register", async (req, res) => {
    try {
      const { cabinet_name, slug, admin_name, email, password } = req.body;
      if (!cabinet_name || !slug || !admin_name || !email || !password) {
        return res.status(400).json({ error: "Tous les champs sont requis." });
      }
      if (String(password).length < 8) {
        return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères." });
      }
      // Vérifier unicité du slug
      const { data: existing } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .single();
      if (existing) {
        return res.status(409).json({ error: "Cet identifiant est déjà pris." });
      }

      // Créer l'utilisateur Supabase Auth SANS confirmer l'email — la confirmation
      // se fait via le lien envoyé ci-dessous (email_confirm: true bypassait
      // totalement la vérification d'adresse).
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const { data: linkData, error: signUpError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'signup',
        email,
        password,
        options: { data: { name: admin_name }, redirectTo: `${appUrl}/login?confirmed=1` },
      });
      if (signUpError || !linkData?.user) {
        return res.status(400).json({ error: signUpError?.message || "Erreur création compte." });
      }
      const userId = linkData.user.id;

      // Créer le tenant
      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .insert({ slug, name: cabinet_name })
        .select()
        .single();
      if (tenantError || !tenant) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return res.status(500).json({ error: "Erreur création cabinet." });
      }
      // Lier le profil au tenant
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: userId, tenant_id: tenant.id, name: admin_name, email, system_role: "admin", role: "admin" });

      const emailSent = linkData.properties?.action_link
        ? await sendPlatformMail(
            email,
            "Confirmez votre adresse email — ArchiOffice",
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
               <h2 style="color: #2563eb;">Bienvenue sur ArchiOffice</h2>
               <p>Bonjour ${admin_name},</p>
               <p>Confirmez votre adresse email pour activer le compte de <strong>${cabinet_name}</strong> :</p>
               <p style="margin: 24px 0;"><a href="${linkData.properties.action_link}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Confirmer mon adresse email</a></p>
               <p style="color: #64748b; font-size: 14px;">Si le bouton ne fonctionne pas, copiez ce lien : ${linkData.properties.action_link}</p>
             </div>`
          )
        : false;

      res.json({ success: true, tenant_id: tenant.id, emailSent });
    } catch (e: any) {
      console.error('[register] Unexpected error:', e);
      res.status(500).json({ error: e.message || "Erreur lors de l'inscription." });
    }
  });

  // Renvoyer l'email de confirmation (ne révèle jamais si le compte existe).
  app.post("/api/public/resend-confirmation", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email) return res.status(400).json({ error: "Email requis" });

      const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
      if (profile) {
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: `${appUrl}/login?confirmed=1` },
        });
        if (linkData?.properties?.action_link) {
          await sendPlatformMail(
            email,
            "Confirmez votre adresse email — ArchiOffice",
            `<p>Confirmez votre adresse email : <a href="${linkData.properties.action_link}">${linkData.properties.action_link}</a></p>`
          );
        }
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Public: get tenant branding info by slug (used on subdomain login page)
  app.get("/api/public/tenant/:slug", async (req: any, res: any) => {
    try {
      const { slug } = req.params;
      const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name, slug').eq('slug', slug).single();
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      const { data: settings } = await supabaseAdmin.from('settings').select('logo_url, agency_name').eq('tenant_id', tenant.id).single();
      res.json({
        slug: tenant.slug,
        name: (settings as any)?.agency_name || tenant.name,
        logoUrl: (settings as any)?.logo_url || null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
            const ids = (Array.isArray(relData) ? relData : []).map((item: any) => item.batiment_groupe_id).filter(Boolean);
            
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
                const ids = (Array.isArray(relData) ? relData : []).map((item: any) => item.batiment_groupe_id).filter(Boolean);
                
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
  app.get("/api/ordres_de_service", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('ordres_de_service').select('*').eq('tenant_id', tenantId);
      if (project_id) query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch OS" });
    }
  });

  app.post("/api/ordres_de_service", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        project_id, os_number, march_number, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      } = req.body || {};
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('ordres_de_service').insert({
        id, tenant_id: tenantId, project_id, os_number, march_number, title, date, description, lot,
        status: status || 'draft', type: type || 'travaux',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'ordre de service "${title || os_number}"`, title || os_number || '', id, 'ordre_de_service', 'Ordres de service');
      res.status(201).json(data);
    } catch (e: any) {
      console.error("Error creating OS:", e);
      res.status(500).json({ error: "Failed to create OS", details: e.message });
    }
  });

  app.put("/api/ordres_de_service/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        os_number, march_number, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
        date_emission, date_ar, date_execution, emetteur_os, destinataire_os, notes_ar,
        delai_execution, delai_unit
      } = req.body;
      const { error } = await supabaseAdmin.from('ordres_de_service').update({
        os_number, march_number, title, date, description, lot, status, type: type || 'travaux',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
        date_emission, date_ar, date_execution, emetteur_os, destinataire_os, notes_ar,
        delai_execution, delai_unit
      }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to update OS" });
    }
  });

  app.delete("/api/ordres_de_service/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: os } = await supabaseAdmin.from('ordres_de_service').select('title, os_number').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('ordres_de_service').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const label = (os as any)?.title || (os as any)?.os_number || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'ordre de service "${label}"`, label, id, 'ordre_de_service', 'Ordres de service');
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete OS" });
    }
  });

  // PATCH status transition for OS
  app.patch("/api/ordres_de_service/:id/status", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status, date_ar, date_execution, notes_ar } = req.body;
      const validStatuses = ['draft', 'submitted', 'approved', 'rejected'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const updateData: any = { status };
      if (status === 'submitted') updateData.date_emission = new Date().toISOString().split('T')[0];
      if (date_ar) updateData.date_ar = date_ar;
      if (date_execution) updateData.date_execution = date_execution;
      if (notes_ar) updateData.notes_ar = notes_ar;
      const { data: os } = await supabaseAdmin.from('ordres_de_service').select('title, os_number').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('ordres_de_service').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const label = (os as any)?.title || (os as any)?.os_number || '';
      const STATUS_LABELS: Record<string, string> = { draft: 'brouillon', submitted: 'soumis', approved: 'approuvé', rejected: 'rejeté' };
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ordre de service "${label}" marqué ${STATUS_LABELS[status] || status}`, label, id, 'ordre_de_service', 'Ordres de service');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // GET next OS number for a project
  app.get("/api/ordres_de_service/next-number", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('ordres_de_service').select('os_number').eq('tenant_id', tenantId);
      if (project_id) (query as any).eq('project_id', project_id as string);
      const { data } = await query;
      const nums = (data || []).map((r: any) => parseInt(r.os_number) || 0);
      const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      res.json({ next: String(next).padStart(3, '0') });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Visa Routes
  app.get("/api/visas", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('visas').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch visas" }); }
  });

  app.post("/api/visas", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, title, date, status, comments, document_url } = req.body;
      const { data, error } = await supabaseAdmin.from('visas').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, title, date, status: status || 'pending', comments, document_url
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create visa" }); }
  });

  app.put("/api/visas/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, date, status, comments, document_url } = req.body;
      const { data, error } = await supabaseAdmin.from('visas')
        .update({ title, date, status, comments, document_url })
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update visa" }); }
  });

  app.delete("/api/visas/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('visas').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete visa" }); }
  });

  // Reception Routes
  app.get("/api/receptions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('receptions').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch receptions" }); }
  });

  app.post("/api/receptions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, date, type, has_reserves, reserves_count, document_url, reference_pv, lieu, signataires, observations, date_limite_levee, pv_valide } = req.body;
      const { data, error } = await supabaseAdmin.from('receptions').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
        reference_pv: reference_pv || null, lieu: lieu || null, signataires: signataires || null,
        observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create reception" }); }
  });

  app.delete("/api/receptions/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('receptions').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete reception" }); }
  });

  app.put("/api/receptions/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { date, type, has_reserves, reserves_count, document_url, reference_pv, lieu, signataires, observations, date_limite_levee, pv_valide } = req.body;
      const { data, error } = await supabaseAdmin.from('receptions').update({
        date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
        reference_pv: reference_pv || null, lieu: lieu || null, signataires: signataires || null,
        observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reception" }); }
  });

  // Reserves
  app.get("/api/reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('reserves').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch reserves" }); }
  });

  app.post("/api/reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
      // Get the next number for this project
      const { data: lastRow } = await supabaseAdmin.from('reserves').select('number').eq('tenant_id', tenantId).eq('project_id', project_id).order('number', { ascending: false }).limit(1).single();
      const nextNumber = ((lastRow as any)?.number || 0) + 1;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('reserves').insert({
        id, tenant_id: tenantId, project_id, reception_id, title, batiment, local,
        status: status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, number: nextNumber
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réserve N° ${nextNumber} "${title}"`, title || '', id, 'reserve', 'Réserves/Observations');
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create reserve" }); }
  });

  app.delete("/api/reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: reserve } = await supabaseAdmin.from('reserves').select('title, number').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('reserves').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réserve N° ${(reserve as any)?.number} "${(reserve as any)?.title || ''}"`, (reserve as any)?.title || '', req.params.id, 'reserve', 'Réserves/Observations');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete reserve" }); }
  });

  app.put("/api/reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, batiment, local, status, lots, entreprises, created_at, due_date } = req.body;
      const { error } = await supabaseAdmin.from('reserves').update({ title, batiment, local, status, lots, entreprises, created_at, due_date }).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ id: req.params.id, title, batiment, local, status, lots, entreprises, created_at, due_date });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reserve" }); }
  });

  // Plans
  app.get("/api/plans", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('plans').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch plans" }); }
  });

  app.post("/api/plans", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, name, file_url } = req.body;
      const id = bodyId || crypto.randomUUID();
      const uploaded_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('plans').insert({ id, tenant_id: tenantId, project_id, name, file_url, uploaded_at });
      if (error) throw error;
      res.json({ id, project_id, name, file_url, uploaded_at });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create plan" }); }
  });

  // Document Routes
  app.get("/api/documents", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('documents').select('*').eq('tenant_id', tenantId);
      if (project_id) query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch documents" }); }
  });

  app.post("/api/documents", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await checkQuota(tenantId, 'documents');
      const { project_id, name, category, phase, description, uploaded_by } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const projectIdVal = project_id === '' || project_id === 'null' ? null : project_id;
      const phaseVal = phase || null;
      const id = crypto.randomUUID();
      const phaseSegment = phaseVal ? `${phaseVal}/` : '';
      const storagePath = `${tenantId}/${projectIdVal || 'general'}/${phaseSegment}${id}/${sanitizeFilename(file.originalname)}`;
      const file_url = await uploadToStorage('documents', storagePath, file.buffer, file.mimetype);
      const uploaded_at = new Date().toISOString();
      const { indice, emetteur, doc_type } = req.body;
      const { error: e1 } = await supabaseAdmin.from('documents').insert({ id, tenant_id: tenantId, project_id: projectIdVal, name, category, phase: phaseVal, version: 1, file_url, uploaded_by, uploaded_at, description, indice: indice || 'A', doc_statut: 'en_cours', emetteur: emetteur || null, doc_type: doc_type || null });
      if (e1) throw e1;
      await supabaseAdmin.from('document_versions').insert({ id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, version: 1, file_url, uploaded_by, uploaded_at, description });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ajout du document "${name}"`, name, id, 'document', 'Documents');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to upload document" }); }
  });

  app.delete("/api/documents/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      // Fetch all version URLs before deleting DB rows
      const { data: doc } = await supabaseAdmin.from('documents').select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { data: versions } = await supabaseAdmin.from('document_versions').select('file_url').eq('document_id', id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('document_versions').delete().eq('document_id', id).eq('tenant_id', tenantId);
      const { error } = await supabaseAdmin.from('documents').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      // Delete storage files (best-effort, don't fail if storage cleanup fails)
      if (versions?.length) {
        for (const v of versions) {
          if (v.file_url?.includes('/object/public/documents/')) {
            deleteFromStorage('documents', v.file_url).catch(() => {});
          }
        }
      }
      const docName = (doc as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du document "${docName}"`, docName, id, 'document', 'Documents');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete document" }); }
  });

  app.put("/api/documents/:id", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { name, category, phase, description, uploaded_by, indice, emetteur, doc_type } = req.body;
      const file = req.file;
      const phaseVal = phase || null;
      if (file) {
        const { data: doc } = await supabaseAdmin.from('documents').select('version, project_id, phase, indice').eq('id', id).eq('tenant_id', tenantId).single();
        const newVersion = ((doc as any)?.version || 1) + 1;
        const currentIndice = (doc as any)?.indice || 'A';
        const nextIndice = String.fromCharCode(currentIndice.charCodeAt(0) + 1);
        const existingPhase = phaseVal || (doc as any)?.phase || null;
        const projectId = (doc as any)?.project_id || 'general';
        const phaseSegment = existingPhase ? `${existingPhase}/` : '';
        const storagePath = `${tenantId}/${projectId}/${phaseSegment}${id}/v${newVersion}-${sanitizeFilename(file.originalname)}`;
        const file_url = await uploadToStorage('documents', storagePath, file.buffer, file.mimetype);
        const uploaded_at = new Date().toISOString();
        const updateFields: any = { name, category, description, version: newVersion, file_url, uploaded_at, indice: nextIndice, doc_statut: 'en_cours', emetteur: emetteur || null, doc_type: doc_type || null };
        if (phaseVal !== undefined) updateFields.phase = phaseVal;
        const { error } = await supabaseAdmin.from('documents').update(updateFields).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
        await supabaseAdmin.from('document_versions').insert({ id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, version: newVersion, file_url, uploaded_by: uploaded_by || 'System', uploaded_at, description });
      } else {
        const updateFields: any = { name, category, description, emetteur: emetteur || null, doc_type: doc_type || null };
        if (indice !== undefined) updateFields.indice = indice;
        if (phaseVal !== undefined) updateFields.phase = phaseVal;
        const { error } = await supabaseAdmin.from('documents').update(updateFields).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update document: " + e.message }); }
  });

  app.get("/api/documents/:id/versions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('document_versions').select('*').eq('tenant_id', tenantId).eq('document_id', id).order('version', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch document versions" }); }
  });

  // PATCH statut d'un document
  app.patch("/api/documents/:id/statut", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { doc_statut, approbateur } = req.body;
      if (!['en_cours', 'approuve', 'perime'].includes(doc_statut)) {
        return res.status(400).json({ error: 'Invalid statut' });
      }
      const updateData: any = { doc_statut };
      if (doc_statut === 'approuve') {
        updateData.approbateur = approbateur || null;
        updateData.date_approbation = new Date().toISOString();
      }
      const { error } = await supabaseAdmin.from('documents').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // GET diffusions d'un document
  app.get("/api/documents/:id/diffusions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('document_diffusions').select('*').eq('tenant_id', tenantId).eq('document_id', id).order('sent_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // POST diffusion (send to recipient)
  app.post("/api/documents/:id/diffusions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { contact_name, contact_email, notes } = req.body;
      if (!contact_name) return res.status(400).json({ error: 'contact_name required' });
      const diffusion = { id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, contact_name, contact_email: contact_email || null, sent_at: new Date().toISOString(), notes: notes || null };
      const { error } = await supabaseAdmin.from('document_diffusions').insert(diffusion);
      if (error) throw error;
      res.status(201).json(diffusion);
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // PATCH acknowledge
  app.patch("/api/documents/:id/diffusions/:diffId/acknowledge", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { diffId } = req.params;
      const { error } = await supabaseAdmin.from('document_diffusions').update({ acknowledged_at: new Date().toISOString() }).eq('id', diffId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  app.get("/api/projects", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('*, project_cotraitants(*), project_lots(*), project_stakeholders(*), project_categories_junction(category_id)')
        .eq('tenant_id', tenantId);
      if (error) throw error;
      const projectsWithDetails = (data || []).map((p: any) => ({
        ...p,
        cotraitants_list: p.project_cotraitants || [],
        lots_list: p.project_lots || [],
        stakeholders_list: p.project_stakeholders || [],
        categories_list: (p.project_categories_junction || []).map((j: any) => j.category_id),
      }));
      res.json(projectsWithDetails);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id/full", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: project, error: pe } = await supabaseAdmin.from('projects').select('*').eq('id', id).eq('tenant_id', tenantId).single();
      if (pe || !project) return res.status(404).json({ error: "Project not found" });
      const [milestones, invoices, specifications, ordres_de_service, visas, receptions, reserves, plans] = await Promise.all([
        supabaseAdmin.from('milestones').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('invoices').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('specifications').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('ordres_de_service').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('visas').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('receptions').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('reserves').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
        supabaseAdmin.from('plans').select('*').eq('project_id', id).eq('tenant_id', tenantId).then(r => r.data || []),
      ]);
      res.json({ project, milestones, invoices, specifications, ordres_de_service, visas, receptions, reserves, plans });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch project details" });
    }
  });

  // API routes FIRST (duplicate health removed below)

  // Situations API
  app.get("/api/dpgf/:projectId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('dpgf_items').select('*').eq('tenant_id', tenantId).eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch dpgf items" }); }
  });

  app.get("/api/situations/:projectId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('situations').select('*').eq('tenant_id', tenantId).eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch situations" }); }
  });

  app.get("/api/situations/:situationId/details", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('detail_situations').select('*').eq('tenant_id', tenantId).eq('situation_id', req.params.situationId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch situation details" }); }
  });

  app.post("/api/projects", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await checkQuota(tenantId, 'projects');
      const {
        id: bodyId, name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission, etudes_notes, chantier_notes, is_public_client, client_siret, client_vat_number,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet
      } = req.body;
      if (!name || !client) return res.status(400).json({ error: "Name and client are required" });
      // Generate project code: YYNNN
      const year = new Date().getFullYear().toString().slice(-2);
      const { count: countVal } = await supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).like('project_code', `${year}%`).then(r => ({ count: r.count || 0 }));
      const project_code = `${year}${((countVal as number) + 1).toString().padStart(3, '0')}`;
      const id = bodyId || crypto.randomUUID();
      const { error: pe } = await supabaseAdmin.from('projects').insert({
        id, tenant_id: tenantId, name, client, status: status || 'Planning', budget: budget || 0,
        category: category || null, start_date: start_date || new Date().toISOString().split('T')[0],
        end_date: end_date || new Date().toISOString().split('T')[0], description: description || null,
        image_url: image_url || null, project_code, address: address || null,
        is_complete_mission: !!is_complete_mission, etudes_notes, chantier_notes, is_public_client: !!is_public_client,
        client_siret: client_siret || null, client_vat_number: client_vat_number || null,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        reference, projet_detail, is_entreprise: !!is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet
      });
      if (pe) throw pe;
      if (cotraitants_list?.length) {
        await supabaseAdmin.from('project_cotraitants').insert(cotraitants_list.map((c: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, specialty: c.specialty, contact_id: c.contact_id || null })));
      }
      if (lots_list?.length) {
        await supabaseAdmin.from('project_lots').insert(lots_list.map((l: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, lot_number: l.lot_number, lot_title: l.lot_title, contact_id: l.contact_id || null })));
      }
      if (stakeholders_list?.length) {
        await supabaseAdmin.from('project_stakeholders').insert(stakeholders_list.map((s: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, name: s.name, role: s.role, contact_id: s.contact_id || null })));
      }
      if (categories_list?.length) {
        await supabaseAdmin.from('project_categories_junction').insert(categories_list.map((catId: string) => ({ project_id: id, category_id: catId, tenant_id: tenantId })));
      }
      // Log activity
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du projet "${name}"`, name, id, 'project', 'Projets');

      res.status(201).json({ id, project_code });
    } catch (error: any) {
      console.error("Error creating project:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to create project" });
    }
  });

  app.put("/api/projects/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission, etudes_notes, chantier_notes, is_public_client, client_siret, client_vat_number,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet
      } = req.body;
      if (!name || !client) return res.status(400).json({ error: "Name and client are required" });
      const { error: ue } = await supabaseAdmin.from('projects').update({
        name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission: !!is_complete_mission, etudes_notes, chantier_notes, is_public_client: !!is_public_client,
        client_siret: client_siret || null, client_vat_number: client_vat_number || null,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        reference, projet_detail, is_entreprise: !!is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet
      }).eq('id', id).eq('tenant_id', tenantId);
      if (ue) throw ue;
      // Update related lists (delete + reinsert)
      await supabaseAdmin.from('project_cotraitants').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (cotraitants_list?.length) {
        await supabaseAdmin.from('project_cotraitants').insert(cotraitants_list.map((c: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, specialty: c.specialty, contact_id: c.contact_id || null })));
      }
      await supabaseAdmin.from('project_lots').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (lots_list?.length) {
        await supabaseAdmin.from('project_lots').insert(lots_list.map((l: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, lot_number: l.lot_number, lot_title: l.lot_title, contact_id: l.contact_id || null })));
      }
      await supabaseAdmin.from('project_stakeholders').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (stakeholders_list?.length) {
        await supabaseAdmin.from('project_stakeholders').insert(stakeholders_list.map((s: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, name: s.name, role: s.role, contact_id: s.contact_id || null })));
      }
      await supabaseAdmin.from('project_categories_junction').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (categories_list?.length) {
        await supabaseAdmin.from('project_categories_junction').insert(categories_list.map((catId: string) => ({ project_id: id, category_id: catId, tenant_id: tenantId })));
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project: " + error.message });
    }
  });

  app.delete("/api/projects/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const userRole = req.headers['x-user-role'];
      console.log(`Attempting to delete project ${id} with role ${userRole}`);
      if (userRole !== 'admin') return res.status(403).json({ error: "Only administrators can delete projects" });
      const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      await Promise.all([
        supabaseAdmin.from('project_team').delete().eq('project_id', id).eq('tenant_id', tenantId),
        supabaseAdmin.from('milestones').delete().eq('project_id', id).eq('tenant_id', tenantId),
        supabaseAdmin.from('specifications').delete().eq('project_id', id).eq('tenant_id', tenantId),
        supabaseAdmin.from('project_cotraitants').delete().eq('project_id', id).eq('tenant_id', tenantId),
      ]);
      const { error } = await supabaseAdmin.from('projects').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const name = (project as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du projet "${name}"`, name, id, 'project', 'Projets');
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project: " + error.message });
    }
  });

  app.get("/api/project_categories", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('project_categories').select('*').eq('tenant_id', tenantId).order('name');
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch project categories" }); }
  });

  app.post("/api/project_categories", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, name } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('project_categories').insert({ id, tenant_id: tenantId, name });
      if (error) throw error;
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create project category" }); }
  });

  app.delete("/api/project_categories/:id", async (req: any, res: any) => {
    try {
      const tenantId2 = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_categories').delete().eq('id', id).eq('tenant_id', tenantId2);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete project category" }); }
  });

  app.get("/api/tasks", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('tasks').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tasks" }); }
  });

  app.post("/api/tasks", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, start_date, end_date, progress, dependencies } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('tasks').insert({ id, tenant_id: tenantId, project_id, title, start_date, end_date, progress: progress || 0, dependencies: dependencies || [] });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la tâche "${title}"`, title, id, 'task', 'Tâches');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create task" }); }
  });

  app.put("/api/tasks/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, start_date, end_date, progress, dependencies } = req.body;
      const { error } = await supabaseAdmin.from('tasks').update({ title, start_date, end_date, progress, dependencies: dependencies || [] }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update task" }); }
  });

  app.delete("/api/tasks/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: task } = await supabaseAdmin.from('tasks').select('title').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const title = (task as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la tâche "${title}"`, title, id, 'task', 'Tâches');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete task" }); }
  });

  app.get("/api/team", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('profiles').select('id, name, email, role, system_role, avatar, sender_option, default_email_template, phone, address, job_title, department').eq('tenant_id', tenantId);
      if (error) throw error;
      res.json((data || []).map((p: any) => ({
        ...p,
        senderOption: p.sender_option,
        defaultEmailTemplate: p.default_email_template,
        jobTitle: p.job_title,
      })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch team" }); }
  });

  app.get("/api/me", async (req: any, res: any) => {
    try {
      const { data, error } = await supabaseAdmin.from('profiles').select('id, tenant_id, name, email, role, system_role, avatar, sender_option, default_email_template, phone, address, job_title, department').eq('id', req.user.id).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return res.json(null);
      res.json({
        ...data,
        tenantId: data.tenant_id,
        senderOption: data.sender_option,
        defaultEmailTemplate: data.default_email_template,
        jobTitle: data.job_title,
      });
    } catch (e: any) { res.status(500).json({ error: "Failed to fetch profile" }); }
  });

  // ─── Agency setup (compte authentifié sans tenant — création OAuth ou en attente de rattachement) ─────

  async function bestEffortNotifyAdmins(tenantId: string, subject: string, html: string) {
    try {
      const { data: admins } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('tenant_id', tenantId)
        .eq('system_role', 'admin');
      const recipients = (admins || []).map((a: any) => a.email).filter(Boolean);
      if (!recipients.length) return;
      const smtpHost = process.env.SMTP_HOST;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      if (!smtpHost || !smtpUser || !smtpPass) return;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(process.env.SMTP_PORT || '587')),
        secure: String(process.env.SMTP_PORT) === '465',
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({ from: `"ArchiOffice" <${smtpUser}>`, to: recipients.join(','), subject, html });
    } catch (e: any) {
      console.error('[agency-setup] Notification email failed:', e.message);
    }
  }

  app.get("/api/agency-setup/status", async (req: any, res: any) => {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', req.user.id).single();
      if (profile?.tenant_id) return res.json({ hasTenant: true, pendingRequest: null });

      const { data: pending } = await supabaseAdmin
        .from('join_requests')
        .select('id, tenant_id, created_at, tenants(name)')
        .eq('user_id', req.user.id)
        .eq('status', 'pending')
        .maybeSingle();

      res.json({
        hasTenant: false,
        pendingRequest: pending ? { id: pending.id, tenantName: (pending as any).tenants?.name, createdAt: pending.created_at } : null,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agency-setup/search", async (req: any, res: any) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json([]);
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(10);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency-setup/create", async (req: any, res: any) => {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', req.user.id).single();
      if (profile?.tenant_id) return res.status(409).json({ error: 'Ce compte est déjà rattaché à une agence' });

      const agencyName = String(req.body?.agencyName || '').trim();
      if (!agencyName) return res.status(400).json({ error: "Le nom de l'agence est requis" });
      const address = req.body?.address ? String(req.body.address) : null;
      const phone = req.body?.phone ? String(req.body.phone) : null;
      const email = req.body?.email ? String(req.body.email) : null;

      const base = agencyName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'cabinet';
      const slug = base + '-' + Date.now().toString(36);

      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from('tenants')
        .insert({ slug, name: agencyName })
        .select()
        .single();
      if (tenantErr || !tenant) return res.status(500).json({ error: tenantErr?.message || 'Erreur création agence' });

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
      const displayName = authUser?.user?.user_metadata?.name || req.user.email?.split('@')[0] || agencyName;

      const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
        id: req.user.id, tenant_id: tenant.id, name: displayName, email: req.user.email, role: 'admin', system_role: 'admin',
      });
      if (profileErr) return res.status(500).json({ error: profileErr.message });

      if (address || phone || email) {
        await supabaseAdmin.from('settings').upsert({ tenant_id: tenant.id, agency_name: agencyName, address, phone, email });
      }

      // Une éventuelle demande de rattachement en attente devient sans objet.
      await supabaseAdmin.from('join_requests').delete().eq('user_id', req.user.id).eq('status', 'pending');

      res.json({ success: true, tenantId: tenant.id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agency-setup/join", async (req: any, res: any) => {
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', req.user.id).single();
      if (profile?.tenant_id) return res.status(409).json({ error: 'Ce compte est déjà rattaché à une agence' });

      const tenantId = String(req.body?.tenantId || '');
      if (!tenantId) return res.status(400).json({ error: 'Agence requise' });
      const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name').eq('id', tenantId).single();
      if (!tenant) return res.status(404).json({ error: 'Agence introuvable' });

      // Une seule demande en attente à la fois : on remplace l'ancienne si elle vise une autre agence.
      await supabaseAdmin.from('join_requests').delete().eq('user_id', req.user.id).eq('status', 'pending');

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
      const name = authUser?.user?.user_metadata?.name || req.user.email?.split('@')[0] || '';

      const { data: request, error } = await supabaseAdmin.from('join_requests').insert({
        tenant_id: tenantId, user_id: req.user.id, email: req.user.email, name,
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });

      bestEffortNotifyAdmins(
        tenantId,
        'Nouvelle demande de rattachement — ArchiOffice',
        `<p>${name || req.user.email} (${req.user.email}) demande à rejoindre votre agence <strong>${tenant.name}</strong> sur ArchiOffice.</p><p>Rendez-vous sur la page Équipe pour approuver ou refuser cette demande.</p>`
      );

      res.json({ success: true, requestId: request.id, tenantName: tenant.name });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/agency-setup/join", async (req: any, res: any) => {
    try {
      await supabaseAdmin.from('join_requests').delete().eq('user_id', req.user.id).eq('status', 'pending');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/team/:id", async (req: any, res: any) => {
    try {
      // Self-service profile edit — anyone else's profile requires admin rights
      const tenantId = req.params.id === req.user.id
        ? await getTenantId(req.user.id)
        : await requireTenantAdmin(req.user.id);
      const { senderOption, defaultEmailTemplate, phone, address, jobTitle, department, avatar } = req.body;
      const { data, error } = await supabaseAdmin.from('profiles').update({
        sender_option: senderOption,
        default_email_template: defaultEmailTemplate,
        phone: phone || null,
        address: address || null,
        job_title: jobTitle || null,
        department: department || null,
        ...(avatar !== undefined ? { avatar: avatar || null } : {}),
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to update profile: " + e.message }); }
  });

  app.post("/api/team", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      await checkQuota(tenantId, 'users');
      const { name, email, role, system_role } = req.body;
      if (!name || !email) return res.status(400).json({ error: "Name and email are required" });
      // Check if user already exists in this tenant
      const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('email', email).eq('tenant_id', tenantId).maybeSingle();
      if (existing) return res.status(400).json({ error: "User with this email already exists" });
      const password = Math.random().toString(36).slice(-8);
      // Create Supabase Auth user
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({ email, password, user_metadata: { name }, email_confirm: true });
      if (authErr || !authData?.user) return res.status(500).json({ error: authErr?.message || "Failed to create auth user" });
      const id = authData.user.id;
      await supabaseAdmin.from('profiles').upsert({ id, tenant_id: tenantId, name, email, role: role || 'Member', system_role: system_role || 'user' });
      // Send email
      let emailSent = false;
      let emailError: string | null = null;
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const smtpHost = (settings as any)?.smtpHost || process.env.SMTP_HOST;
      const smtpPort = (settings as any)?.smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = (settings as any)?.smtpUser || process.env.SMTP_USER;
      const smtpPass = (settings as any)?.smtpPass || process.env.SMTP_PASS;

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
            from: `"ArchiOffice" <${smtpUser}>`,
            to: email,
            subject: "Your ArchiOffice Credentials",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #2563eb;">Welcome to ArchiOffice</h2>
                <p>Hello ${name},</p>
                <p>An account has been created for you on ArchiOffice. Here are your credentials to access the application:</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
                  <p style="margin: 10px 0 0 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 5px 0 0 0;"><strong>Temporary Password:</strong> ${password}</p>
                </div>
                <p>Please change your password after your first login.</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px;">Best regards,<br>The ArchiOffice Team</p>
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
        const missing: string[] = [];
        if (!smtpHost) missing.push('smtpHost');
        if (!smtpUser) missing.push('smtpUser');
        if (!smtpPass) missing.push('smtpPass');
        console.warn(`[Team Creation] SMTP settings missing (${missing.join(', ')}), skipping credentials email.`);
        emailError = `Configuration SMTP manquante : ${missing.join(', ')}`;
      }

      res.status(201).json({ id, name, email, role, system_role, emailSent, emailError });
    } catch (error: any) {
      console.error("Error creating team member:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to create team member" });
    }
  });

  app.put("/api/team/:id/role", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { id } = req.params;
      const { role } = req.body;
      const { error } = await supabaseAdmin.from('profiles').update({ system_role: role }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error updating user role:", e);
      res.status(e.status || 500).json({ error: e.status ? e.message : "Failed to update role" });
    }
  });

  async function requireTenantAdmin(userId: string): Promise<string> {
    const tenantId = await getTenantId(userId);
    const { data: profile } = await supabaseAdmin.from('profiles').select('system_role').eq('id', userId).single();
    if (profile?.system_role !== 'admin') {
      const err: any = new Error("Réservé aux administrateurs de l'agence");
      err.status = 403;
      throw err;
    }
    return tenantId;
  }

  app.get("/api/team/join-requests", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('join_requests')
        .select('id, email, name, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post("/api/team/join-requests/:id/approve", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data: request } = await supabaseAdmin.from('join_requests').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).eq('status', 'pending').single();
      if (!request) return res.status(404).json({ error: 'Demande introuvable' });

      await checkQuota(tenantId, 'users');

      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', request.user_id).single();
      if (existingProfile?.tenant_id) return res.status(409).json({ error: 'Cet utilisateur est déjà rattaché à une agence' });

      const { error: profileErr } = await supabaseAdmin.from('profiles').update({
        tenant_id: tenantId, email: request.email, name: request.name, role: 'Member', system_role: 'user',
      }).eq('id', request.user_id);
      if (profileErr) return res.status(500).json({ error: profileErr.message });

      await supabaseAdmin.from('join_requests').update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: req.user.id }).eq('id', request.id);
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post("/api/team/join-requests/:id/reject", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('join_requests')
        .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: req.user.id })
        .eq('id', req.params.id).eq('tenant_id', tenantId).eq('status', 'pending')
        .select().single();
      if (error || !data) return res.status(404).json({ error: 'Demande introuvable' });
      res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get("/api/tenders", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('tenders').select('*, tender_specialties(*)').eq('tenant_id', tenantId);
      if (error) throw error;
      res.json((data || []).map((t: any) => ({ ...t, specialties_list: t.tender_specialties || [] })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tenders" }); }
  });

  app.get("/api/tenders/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('tenders').select('*, tender_specialties(*)').eq('id', id).eq('tenant_id', tenantId).single();
      if (error || !data) return res.status(404).json({ error: "Tender not found" });
      res.json({ ...data, specialties_list: (data as any).tender_specialties || [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tender" }); }
  });

  app.post("/api/tenders", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, client, submission_deadline, status, value, notes, mandataire_id, type, surface, construction_cost, honoraires_percent, mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list } = req.body;
      const id = crypto.randomUUID();
      const { error: te } = await supabaseAdmin.from('tenders').insert({ id, tenant_id: tenantId, title, client, submission_deadline, status: status || 'Draft', value: value || 0, notes: notes || '', mandataire_id: mandataire_id || null, type, surface: surface || 0, construction_cost: construction_cost || 0, honoraires_percent: honoraires_percent || 0, mandatory_visit: !!mandatory_visit, visit_date: visit_date || null, withdrawal_deadline: withdrawal_deadline || null, archived: !!archived });
      if (te) throw te;
      if (specialties_list?.length) await supabaseAdmin.from('tender_specialties').insert(specialties_list.map((s: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, tender_id: id, specialty_name: s.specialty_name, contact_id: s.contact_id || null })));
      if (milestones_list?.length) await supabaseAdmin.from('milestones').insert(milestones_list.map((m: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, tender_id: id, title: m.title, due_date: m.due_date, completed: !!m.completed })));
      const { data } = await supabaseAdmin.from('tenders').select('*, tender_specialties(*)').eq('id', id).single();
      // Log activity
      const userNameTndr = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userNameTndr, `Nouvel appel d'offres "${title}"`, title, id, 'tender', 'Appels d\'offres');
      res.status(201).json({ ...(data || {}), specialties_list: (data as any)?.tender_specialties || [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create tender: " + e.message }); }
  });

  app.delete("/api/tenders/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: tender } = await supabaseAdmin.from('tenders').select('title').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      await supabaseAdmin.from('tender_specialties').delete().eq('tender_id', id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('milestones').delete().eq('tender_id', id).eq('tenant_id', tenantId);
      const { error } = await supabaseAdmin.from('tenders').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const title = (tender as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'appel d'offres "${title}"`, title, id, 'tender', 'Appels d\'offres');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete tender" }); }
  });

  app.put("/api/tenders/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, client, submission_deadline, status, value, notes, mandataire_id, type, surface, construction_cost, honoraires_percent, mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list } = req.body;
      const { error: ue } = await supabaseAdmin.from('tenders').update({ title, client, submission_deadline, status, value: value || 0, notes: notes || '', mandataire_id: mandataire_id || null, type, surface: surface || 0, construction_cost: construction_cost || 0, honoraires_percent: honoraires_percent || 0, mandatory_visit: !!mandatory_visit, visit_date: visit_date || null, withdrawal_deadline: withdrawal_deadline || null, archived: !!archived }).eq('id', id).eq('tenant_id', tenantId);
      if (ue) throw ue;
      await supabaseAdmin.from('tender_specialties').delete().eq('tender_id', id).eq('tenant_id', tenantId);
      if (specialties_list?.length) await supabaseAdmin.from('tender_specialties').insert(specialties_list.map((s: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, tender_id: id, specialty_name: s.specialty_name, contact_id: s.contact_id || null })));
      await supabaseAdmin.from('milestones').delete().eq('tender_id', id).eq('tenant_id', tenantId);
      if (milestones_list?.length) await supabaseAdmin.from('milestones').insert(milestones_list.map((m: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, tender_id: id, title: m.title, due_date: m.due_date, completed: !!m.completed })));
      const { data } = await supabaseAdmin.from('tenders').select('*, tender_specialties(*)').eq('id', id).single();
      res.json({ ...(data || {}), specialties_list: (data as any)?.tender_specialties || [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update tender: " + e.message }); }
  });

  app.get("/api/milestones", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, tender_id, proposal_id } = req.query;
      const query = supabaseAdmin.from('milestones').select('*').eq('tenant_id', tenantId).order('due_date', { ascending: true });
      if (project_id) query.eq('project_id', project_id as string);
      else if (tender_id) query.eq('tender_id', tender_id as string);
      else if (proposal_id) query.eq('proposal_id', proposal_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch milestones" }); }
  });

  app.post("/api/milestones", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, tender_id, proposal_id, title, due_date, completed } = req.body;
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('milestones').insert({ id, tenant_id: tenantId, project_id: project_id || null, tender_id: tender_id || null, proposal_id: proposal_id || null, title, due_date, completed: !!completed }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create milestone: " + e.message }); }
  });

  app.put("/api/milestones/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, due_date, completed } = req.body;
      const { error } = await supabaseAdmin.from('milestones').update({ title, due_date, completed: !!completed }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update milestone: " + e.message }); }
  });

  app.delete("/api/milestones/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('milestones').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete milestone: " + e.message }); }
  });

  app.get("/api/specifications", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('specifications').select('*').eq('tenant_id', tenantId).order('last_updated', { ascending: false });
      if (error) throw error;
      res.json((data || []).map((s: any) => ({ ...s, is_template: !!s.is_template })));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch specifications" });
    }
  });

  app.post("/api/specifications", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, content, is_template } = req.body;
      const id = bodyId || crypto.randomUUID();
      const last_updated = new Date().toISOString();
      const { error } = await supabaseAdmin.from('specifications').insert({ id, tenant_id: tenantId, project_id, title, content, last_updated, is_template: !!is_template });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du CCTP "${title}"`, title, id, 'specification', 'CCTP');
      res.status(201).json({ id, last_updated });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create specification: " + e.message }); }
  });

  app.put("/api/specifications/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, content, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { error } = await supabaseAdmin.from('specifications').update({ title, content, last_updated, is_template: !!is_template }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true, last_updated });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update specification: " + e.message }); }
  });

  app.delete("/api/specifications/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: spec } = await supabaseAdmin.from('specifications').select('title').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('specifications').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const title = (spec as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du CCTP "${title}"`, title, id, 'specification', 'CCTP');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete specification: " + e.message }); }
  });

  app.get("/api/contacts", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      res.json((data || []).map((c: any) => ({ ...c, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch contacts" }); }
  });

  app.post("/api/contacts", async (req: any, res: any) => {
    console.log("POST /api/contacts hit");
    try {
      const tenantId = await getTenantId(req.user.id);
      const contact = req.body;
      const id = contact.id || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('contacts').insert({ ...contact, id, tenant_id: tenantId });
      if (error) throw error;
      const contactName = contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du contact "${contactName}"`, contactName, id, 'contact', 'Contacts');
      res.status(201).json({ id });
    } catch (e: any) {
      console.error("Error creating contact:", e.message);
      res.status(500).json({ error: "Failed to create contact: " + e.message });
    }
  });

  app.put("/api/contacts/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const contact = req.body;
      // Strip computed/non-column fields before sending to Supabase
      const { id: _id, tenant_id: _t, name: _name, ...updateData } = contact;
      const { error } = await supabaseAdmin.from('contacts').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error updating contact:", e.message);
      res.status(500).json({ error: "Failed to update contact: " + e.message });
    }
  });

  app.delete("/api/contacts/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: contact } = await supabaseAdmin.from('contacts').select('first_name, last_name, company_name').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('contacts').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const contactName = (contact as any)?.company_name || `${(contact as any)?.first_name || ''} ${(contact as any)?.last_name || ''}`.trim();
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du contact "${contactName}"`, contactName, id, 'contact', 'Contacts');
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error deleting contact:", e.message);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.get("/api/contact-categories", async (req: any, res: any) => {
    console.log("GET /api/contact-categories called");
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('contact_categories').select('*').eq('tenant_id', tenantId).order('name');
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch contact categories" }); }
  });

  // ── Contrats MOE ──────────────────────────────────────────────────────────

  app.get("/api/contrats_moe", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('contrats_moe')
        .select('*, contacts(first_name, last_name, company_name), projects(name)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = (data || []).map((c: any) => {
        const contact = c.contacts;
        const client_name = contact
          ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
          : '';
        const { contacts: _c, projects: _p, ...rest } = c;
        return { ...rest, client_name, project_name: c.projects?.name || '' };
      });
      res.json(result);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to fetch contrats MOE' }); }
  });

  app.post("/api/contrats_moe", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body;
      const id = body.id || crypto.randomUUID();
      const { client_name: _cn, project_name: _pn, ...insertData } = body;
      const { error } = await supabaseAdmin
        .from('contrats_moe')
        .insert({ ...insertData, id, tenant_id: tenantId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (error) throw error;
      const { data: created } = await supabaseAdmin
        .from('contrats_moe')
        .select('*, contacts(first_name, last_name, company_name), projects(name)')
        .eq('id', id).single();
      const contact = (created as any)?.contacts;
      const client_name = contact
        ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
        : '';
      const { contacts: _c, projects: _p, ...rest } = (created as any) || {};
      res.status(201).json({ ...rest, client_name, project_name: (created as any)?.projects?.name || '' });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to create contrat MOE: ' + e.message }); }
  });

  app.put("/api/contrats_moe/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { client_name: _cn, project_name: _pn, id: _id, tenant_id: _tid, created_at: _ca, ...updateData } = req.body;
      const { error } = await supabaseAdmin
        .from('contrats_moe')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const { data: updated } = await supabaseAdmin
        .from('contrats_moe')
        .select('*, contacts(first_name, last_name, company_name), projects(name)')
        .eq('id', id).single();
      const contact = (updated as any)?.contacts;
      const client_name = contact
        ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
        : '';
      const { contacts: _c, projects: _p, ...rest } = (updated as any) || {};
      res.json({ ...rest, client_name, project_name: (updated as any)?.projects?.name || '' });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to update contrat MOE: ' + e.message }); }
  });

  app.delete("/api/contrats_moe/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin
        .from('contrats_moe')
        .delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to delete contrat MOE' }); }
  });

  // ── End Contrats MOE ───────────────────────────────────────────────────────

  // ── Notes d'honoraires ────────────────────────────────────────────────────

  app.get("/api/notes_honoraires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.query.project_id as string | undefined;
      let query = supabaseAdmin.from('notes_honoraires').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to fetch notes honoraires' }); }
  });

  app.post("/api/notes_honoraires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body;
      const id = body.id || crypto.randomUUID();
      const { id: _id, tenant_id: _tid, created_at: _ca, updated_at: _ua, ...insertData } = body;
      // Auto-generate numero if not provided
      if (!insertData.numero) {
        insertData.numero = await getNextDocNumber(tenantId, 'num_prefix_honoraires', 'notes_honoraires', 'NH');
      }
      const { error } = await supabaseAdmin.from('notes_honoraires').insert({ ...insertData, id, tenant_id: tenantId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (error) throw error;
      const { data: created } = await supabaseAdmin.from('notes_honoraires').select('*').eq('id', id).single();
      res.status(201).json(created);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to create note honoraires: ' + e.message }); }
  });

  app.put("/api/notes_honoraires/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { id: _id, tenant_id: _tid, created_at: _ca, ...updateData } = req.body;
      const { error } = await supabaseAdmin.from('notes_honoraires').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const { data: updated } = await supabaseAdmin.from('notes_honoraires').select('*').eq('id', id).single();
      res.json(updated);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to update note honoraires: ' + e.message }); }
  });

  app.delete("/api/notes_honoraires/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('notes_honoraires').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to delete note honoraires' }); }
  });

  // ── End Notes d'honoraires ────────────────────────────────────────────────

  app.get("/api/proposals", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: proposals, error } = await supabaseAdmin.from('proposals').select('*, proposal_specialties(*), contacts(first_name, last_name)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (error) throw error;
      const result = (proposals || []).map((p: any) => {
        const contact = p.contacts;
        const client_name = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
        const { contacts: _c, ...rest } = p;
        return { ...rest, client_name, specialties_list: p.proposal_specialties || [] };
      });
      res.json(result);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch proposals" }); }
  });

  // ── Numbering helper ──────────────────────────────────────────────────────
  const getNextDocNumber = async (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string): Promise<string> => {
    const year = new Date().getFullYear();
    const { data: s } = await supabaseAdmin.from('settings').select(settingCol).eq('tenant_id', tenantId).single();
    const prefix = (s as any)?.[settingCol] || defaultPrefix;
    const { count } = await supabaseAdmin.from(countTable).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    const seq = String((count || 0) + 1).padStart(3, '0');
    return `${prefix}-${year}-${seq}`;
  };

  app.post("/api/proposals", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const p = req.body;
      const id = p.id || crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { specialties_list, client_name: _cn, construction_cost_num: _ccn, ...proposalData } = p;
      // Auto-generate readable reference if not provided
      if (!proposalData.reference) {
        proposalData.reference = await getNextDocNumber(tenantId, 'num_prefix_devis', 'proposals', 'DEVIS');
      }
      const { error: insErr } = await supabaseAdmin.from('proposals').insert({ ...proposalData, id, tenant_id: tenantId, created_at, amount: p.amount || 0, status: p.status || 'Draft' });
      if (insErr) throw insErr;
      if (specialties_list && Array.isArray(specialties_list)) {
        const specs = specialties_list.map((spec: any) => ({ id: crypto.randomUUID(), proposal_id: id, tenant_id: tenantId, specialty_name: spec.specialty_name, contact_id: spec.contact_id || null }));
        if (specs.length > 0) { const { error: specErr } = await supabaseAdmin.from('proposal_specialties').insert(specs); if (specErr) throw specErr; }
      }
      const { data: proposal } = await supabaseAdmin.from('proposals').select('*, proposal_specialties(*), contacts(first_name, last_name)').eq('id', id).single();
      const contact = (proposal as any)?.contacts;
      const client_name = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
      const { contacts: _c, ...rest } = (proposal as any) || {};
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du devis "${proposalData.reference}"`, client_name, id, 'proposal', 'Devis');
      res.status(201).json({ ...rest, client_name, specialties_list: (proposal as any)?.proposal_specialties || [] });
    } catch (error: any) {
      console.error("Error creating proposal:", error);
      res.status(500).json({ error: "Failed to create proposal: " + error.message });
    }
  });

  app.put("/api/proposals/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const p = req.body;

      // Fetch old proposal to check status transition
      const { data: oldProposal } = await supabaseAdmin.from('proposals').select('status').eq('id', id).eq('tenant_id', tenantId).single();

      const { specialties_list, proposal_specialties: _ps, id: _pid, tenant_id: _tid, created_at: _ca, client_name: _cn, construction_cost_num: _ccn2, ...updateData } = p;
      const { error: updErr } = await supabaseAdmin.from('proposals').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (updErr) throw updErr;

      // Update specialties: delete + reinsert
      await supabaseAdmin.from('proposal_specialties').delete().eq('proposal_id', id).eq('tenant_id', tenantId);
      if (specialties_list && Array.isArray(specialties_list) && specialties_list.length > 0) {
        const specs = specialties_list.map((spec: any) => ({ id: spec.id || crypto.randomUUID(), proposal_id: id, tenant_id: tenantId, specialty_name: spec.specialty_name, contact_id: spec.contact_id || null }));
        const { error: specErr } = await supabaseAdmin.from('proposal_specialties').insert(specs);
        if (specErr) throw specErr;
      }

      // If status changed to Accepted, create a project
      if (p.status === 'Accepted' && oldProposal?.status !== 'Accepted') {
        const projectId = crypto.randomUUID();
        let clientName = 'Unknown Client';
        if (p.client_id) {
          const { data: clientData } = await supabaseAdmin.from('contacts').select('first_name, last_name').eq('id', p.client_id).single();
          if (clientData) clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim();
        }
        const { error: projErr } = await supabaseAdmin.from('projects').insert({
          id: projectId, tenant_id: tenantId,
          name: p.title, client: clientName, status: 'Planning', budget: p.amount, description: p.description,
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          address: p.adresse_terrain ? `${p.adresse_terrain}, ${p.cp_ville_terrain || ''}` : '',
          reference: p.reference, projet_detail: p.projet_detail, is_entreprise: p.is_entreprise,
          nom_societe: p.nom_societe, rcs: p.rcs, representant: p.representant, qualite: p.qualite,
          adresse_client: p.adresse_client, cp_client: p.cp_client, ville_client: p.ville_client,
          telephone: p.telephone, portable: p.portable, email_client: p.email_client,
          adresse_terrain: p.adresse_terrain, cp_ville_terrain: p.cp_ville_terrain,
          ban_id_terrain: p.ban_id_terrain, city_code_terrain: p.city_code_terrain,
          ref_cadastrale: p.ref_cadastrale, zone_plu: p.zone_plu, surface_parcelle: p.surface_parcelle,
          nom_etablissement: p.nom_etablissement, avant_trav: p.avant_trav, apres_trav: p.apres_trav,
          type_et_cat: p.type_et_cat, type_projet: p.type_projet, categorie_projet: p.categorie_projet,
          surface_plancher: p.surface_plancher, surface_plancher_ext: p.surface_plancher_ext,
          surface_erp: p.surface_erp, surface_ert: p.surface_ert,
          effectif_public: p.effectif_public, effectif_personnel: p.effectif_personnel,
          ind: p.ind, date_modification: p.date_modification,
          maf_intercalaire: p.maf_intercalaire, taux_mission: p.taux_mission, part_interet: p.part_interet
        });
        if (projErr) throw projErr;
        // Copy specialties to cotraitants
        if (specialties_list && Array.isArray(specialties_list) && specialties_list.length > 0) {
          const cots = specialties_list.map((spec: any) => ({ id: crypto.randomUUID(), project_id: projectId, tenant_id: tenantId, specialty: spec.specialty_name, contact_id: spec.contact_id || null }));
          await supabaseAdmin.from('project_cotraitants').insert(cots);
        }
      }

      const { data: proposal } = await supabaseAdmin.from('proposals').select('*, proposal_specialties(*), contacts(first_name, last_name)').eq('id', id).single();
      const contact = (proposal as any)?.contacts;
      const client_name = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
      const { contacts: _c, ...rest } = (proposal as any) || {};
      res.json({ ...rest, client_name, specialties_list: (proposal as any)?.proposal_specialties || [] });
    } catch (error: any) {
      console.error("Error updating proposal:", error);
      res.status(500).json({ error: "Failed to update proposal: " + error.message });
    }
  });

  app.delete("/api/proposals/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: proposal } = await supabaseAdmin.from('proposals').select('title, status').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if ((proposal as any)?.status !== 'Draft') {
        return res.status(400).json({ error: "Seuls les devis en brouillon peuvent être supprimés. Rejetez ce devis à la place." });
      }
      await supabaseAdmin.from('proposal_specialties').delete().eq('proposal_id', id).eq('tenant_id', tenantId);
      const { error } = await supabaseAdmin.from('proposals').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const title = (proposal as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du devis "${title}"`, title, id, 'proposal', 'Devis');
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error deleting proposal:", e);
      res.status(500).json({ error: "Failed to delete proposal: " + e.message });
    }
  });

  app.get("/api/proposals/:id/export", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: proposal, error } = await supabaseAdmin.from('proposals').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
      if (error || !proposal) return res.status(404).json({ error: "Proposal not found" });
      const xml = proposalToXml(proposal);
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename=proposal_${(proposal as any).id}.xml`);
      res.send(xml);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to export proposal" }); }
  });

  app.post("/api/proposals/import", upload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const tenantId = await getTenantId(req.user.id);
      const xml = req.file.buffer.toString('utf-8');
      const proposalData = xmlToProposal(xml);
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('proposals').insert({ id, tenant_id: tenantId, title: proposalData.title || 'Imported Proposal', description: proposalData.description || '', created_at, status: 'Draft' });
      if (error) throw error;
      res.json({ success: true, id });
    } catch (error: any) {
      console.error("Error importing proposal:", error);
      res.status(500).json({ error: "Failed to import proposal: " + error.message });
    }
  });

  app.get("/api/invoices", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: invoices, error } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (error) throw error;
      const result = (invoices || []).map((inv: any) => {
        const project_name = inv.projects?.name || null;
        const { projects: _p, invoice_items, ...rest } = inv;
        return { ...rest, project_name, items: invoice_items || [] };
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoices", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        project_id, amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        invoice_type, mission_id, mission_name, advancement_pct,
        items
      } = req.body;

      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();

      // Fetch default seller info from settings if not provided
      let finalSellerName = seller_name;
      let finalSellerAddress = seller_address;
      let finalSellerSiret = seller_siret;
      let finalSellerVatNumber = seller_vat_number;
      let finalSellerIban = seller_iban;
      let finalSellerBic = seller_bic;

      if (!finalSellerName || !finalSellerAddress || !finalSellerSiret) {
        const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
        if (settings) {
          finalSellerName = finalSellerName || (settings as any).agencyName;
          finalSellerAddress = finalSellerAddress || (settings as any).address;
          finalSellerSiret = finalSellerSiret || (settings as any).siret;
          finalSellerVatNumber = finalSellerVatNumber || (settings as any).vatNumber;
          finalSellerIban = finalSellerIban || (settings as any).seller_iban;
          finalSellerBic = finalSellerBic || (settings as any).seller_bic;
        }
      }

      // Auto-generate invoice_number if not provided
      const finalInvoiceNumber = invoice_number || await getNextDocNumber(tenantId, 'num_prefix_facture', 'invoices', 'FAC');

      const { error: insErr } = await supabaseAdmin.from('invoices').insert({
        id, tenant_id: tenantId, invoice_number: finalInvoiceNumber, project_id,
        amount: amount || 0, tax_amount: tax_amount || 0, total_amount: total_amount || 0,
        status: status || 'Draft', due_date: due_date || null,
        issue_date: issue_date || created_at.split('T')[0], description: description || '', created_at,
        seller_name: finalSellerName || null, seller_address: finalSellerAddress || null,
        seller_siret: finalSellerSiret || null, seller_vat_number: finalSellerVatNumber || null,
        seller_iban: finalSellerIban || null, seller_bic: finalSellerBic || null, vat_rate: vat_rate || 20,
        invoice_type: invoice_type || 'standard',
        mission_id: mission_id || null, mission_name: mission_name || null, advancement_pct: advancement_pct || 0
      });
      if (insErr) throw insErr;

      if (items && Array.isArray(items) && items.length > 0) {
        const itemRows = items.map((item: any) => ({ id: crypto.randomUUID(), invoice_id: id, tenant_id: tenantId, description: item.description, quantity: item.quantity, unit_price: item.unit_price, vat_rate: item.vat_rate }));
        const { error: itemErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
        if (itemErr) throw itemErr;
      }

      const { data: invoice } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('id', id).single();
      const project_name = (invoice as any)?.projects?.name || null;
      const { projects: _p, invoice_items, ...rest } = (invoice as any) || {};

      // Log activity
      const userNameInv = await getUserName(tenantId, req.user.id, req.user.email);
      const invLabel = invoice_type === 'acompte' ? "Facture d'acompte" : 'Facture';
      logActivity(tenantId, req.user.id, userNameInv, `Création de la ${invLabel.toLowerCase()} N° ${invoice_number || id.slice(0, 8)}`, project_name || '', id, 'invoice', 'Factures');

      res.status(201).json({ ...rest, project_name, items: invoice_items || [] });
    } catch (error: any) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ error: "Failed to create invoice: " + error.message });
    }
  });

  app.put("/api/invoices/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        invoice_type, mission_id, mission_name, advancement_pct,
        items
      } = req.body;

      const { error: updErr } = await supabaseAdmin.from('invoices').update({
        amount: amount || 0, description: description || '', status: status || 'Draft', due_date: due_date || null,
        invoice_number: invoice_number || null, tax_amount: tax_amount || 0, total_amount: total_amount || 0, issue_date: issue_date || null,
        seller_name: seller_name || null, seller_address: seller_address || null, seller_siret: seller_siret || null,
        seller_vat_number: seller_vat_number || null, seller_iban: seller_iban || null, seller_bic: seller_bic || null, vat_rate: vat_rate || 20,
        invoice_type: invoice_type || 'standard',
        mission_id: mission_id || null, mission_name: mission_name || null, advancement_pct: advancement_pct || 0
      }).eq('id', id).eq('tenant_id', tenantId);
      if (updErr) throw updErr;

      if (items && Array.isArray(items)) {
        await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', id).eq('tenant_id', tenantId);
        if (items.length > 0) {
          const itemRows = items.map((item: any) => ({ id: item.id || crypto.randomUUID(), invoice_id: id, tenant_id: tenantId, description: item.description, quantity: item.quantity, unit_price: item.unit_price, vat_rate: item.vat_rate }));
          const { error: itemErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
          if (itemErr) throw itemErr;
        }
      }

      const { data: invoice } = await supabaseAdmin.from('invoices').select('*, invoice_items(*), projects(name)').eq('id', id).single();
      const project_name = (invoice as any)?.projects?.name || null;
      const { projects: _p, invoice_items, ...rest } = (invoice as any) || {};
      res.json({ ...rest, project_name, items: invoice_items || [] });
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ error: "Failed to update invoice: " + error.message });
    }
  });

  app.post("/api/contact-categories", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, name } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('contact_categories').insert({ id, tenant_id: tenantId, name });
      if (error) throw error;
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create contact category" });
    }
  });

  app.delete("/api/contact-categories/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('contact_categories').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete contact category" });
    }
  });

  // ── Google Contacts sync ─────────────────────────────────────────────────
  app.post("/api/sync/google-contacts", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      // Google People API requires OAuth2. The client initiates the OAuth flow
      // and passes the access_token in the request body.
      const { access_token } = req.body;
      if (!access_token) {
        return res.status(400).json({ error: "access_token requis. Veuillez d'abord autoriser l'accès à Google Contacts." });
      }

      // Fetch contacts from Google People API
      const googleRes = await fetch(
        'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,addresses&pageSize=1000',
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (!googleRes.ok) {
        return res.status(400).json({ error: "Token Google invalide ou expiré" });
      }
      const googleData: any = await googleRes.json();
      const connections: any[] = googleData.connections || [];

      let imported = 0;
      let updated = 0;

      for (const person of connections) {
        const name = person.names?.[0] || {};
        const email = person.emailAddresses?.[0]?.value || '';
        const phone = person.phoneNumbers?.[0]?.value || '';
        const org = person.organizations?.[0] || {};
        const addr = person.addresses?.[0] || {};

        if (!name.givenName && !name.familyName && !email) continue;

        // Check if contact already exists by email
        const { data: existing } = await supabaseAdmin
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('email', email)
          .maybeSingle();

        const contactData = {
          tenant_id: tenantId,
          first_name: name.givenName || '',
          last_name: name.familyName || '',
          email: email,
          phone: phone,
          company_name: org.name || '',
          job_title: org.title || '',
          city: addr.city || '',
          zip: addr.postalCode || '',
          country: addr.country || '',
          updated_at: new Date().toISOString()
        };

        if (existing) {
          await supabaseAdmin.from('contacts').update(contactData).eq('id', existing.id);
          updated++;
        } else {
          await supabaseAdmin.from('contacts').insert({ ...contactData, id: crypto.randomUUID(), address: '', state: '', ca_amount: 0, created_at: new Date().toISOString() });
          imported++;
        }
      }

      res.json({ imported, updated });
    } catch (error: any) {
      console.error('Google Contacts sync error:', error);
      res.status(500).json({ error: error.message || "Erreur de synchronisation Google Contacts" });
    }
  });

  // ── CardDAV sync ─────────────────────────────────────────────────────────
  app.post("/api/sync/carddav", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { url, username, password } = req.body;
      if (!url || !username) {
        return res.status(400).json({ error: "URL et nom d'utilisateur requis" });
      }

      const auth = Buffer.from(`${username}:${password}`).toString('base64');

      // PROPFIND to list vCards
      const propfindRes = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${auth}`,
          Depth: '1',
          'Content-Type': 'application/xml',
        },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop></d:propfind>'
      });

      if (!propfindRes.ok) {
        return res.status(400).json({ error: `Erreur CardDAV ${propfindRes.status}: vérifiez l'URL et les identifiants` });
      }

      const xml = await propfindRes.text();

      // Simple vCard parser — extract FN, EMAIL, TEL, ORG from each vCard block
      const vcards = xml.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || [];
      const getField = (vcard: string, field: string) => {
        const m = vcard.match(new RegExp(`(?:^|\\n)${field}[^:]*:([^\\r\\n]*)`, 'i'));
        return m ? m[1].trim() : '';
      };

      let imported = 0;
      let updated = 0;

      for (const vcard of vcards) {
        const fullName = getField(vcard, 'FN');
        const email = getField(vcard, 'EMAIL');
        const phone = getField(vcard, 'TEL');
        const org = getField(vcard, 'ORG');
        const nField = getField(vcard, 'N');
        const nameParts = nField.split(';');
        const lastName = nameParts[0] || '';
        const firstName = nameParts[1] || (fullName.split(' ')[0] || '');

        if (!fullName && !email) continue;

        const { data: existing } = await supabaseAdmin
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('email', email)
          .maybeSingle();

        const contactData = {
          tenant_id: tenantId,
          first_name: firstName,
          last_name: lastName || fullName,
          email: email,
          phone: phone,
          company_name: org.split(';')[0] || '',
          updated_at: new Date().toISOString()
        };

        if (existing) {
          await supabaseAdmin.from('contacts').update(contactData).eq('id', existing.id);
          updated++;
        } else {
          await supabaseAdmin.from('contacts').insert({ ...contactData, id: crypto.randomUUID(), address: '', city: '', zip: '', state: '', country: '', ca_amount: 0, created_at: new Date().toISOString() });
          imported++;
        }
      }

      res.json({ imported, updated });
    } catch (error: any) {
      console.error('CardDAV sync error:', error);
      res.status(500).json({ error: error.message || "Erreur de synchronisation CardDAV" });
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
      const { lon, lat, bbox } = req.query;

      let geom: { type: string; coordinates: any };
      if (bbox) {
        const parts = String(bbox).split(',').map(Number);
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
          return res.status(400).json({ error: "Invalid bbox parameter, expected minLon,minLat,maxLon,maxLat" });
        }
        const [minLon, minLat, maxLon, maxLat] = parts;
        geom = {
          type: 'Polygon',
          coordinates: [[
            [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat],
          ]],
        };
        console.log(`[Cadastre] Lookup request: bbox=${bbox}`);
      } else if (lon && lat) {
        geom = { type: 'Point', coordinates: [Number(lon), Number(lat)] };
        console.log(`[Cadastre] Lookup request: lon=${lon}, lat=${lat}`);
      } else {
        return res.status(400).json({ error: "Missing longitude/latitude or bbox parameters" });
      }

      const apiUrl = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify(geom))}&_limit=1000`;
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
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: id15,
            section: id15.substring(8, 10),
            numero: id15.substring(10),
            prefixe: id15.substring(5, 8),
            commune: urlCommune,
            insee: p.code_insee || urlCommune,
            contenance: p.contenance
          }
        };
      });

      console.log(`[Cadastre] Success: Found ${mappedFeatures.length} parcels`);
      res.json({ type: 'FeatureCollection', features: mappedFeatures });
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

  // ── Activity Feed ──────────────────────────────────────────────────────────

  const logActivity = async (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => {
    try {
      const { error } = await supabaseAdmin.from('activities').insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        user_id: userId,
        user_name: userName,
        action,
        target,
        target_id: targetId,
        target_type: targetType,
        category,
        created_at: new Date().toISOString()
      });
      if (error) console.error('[logActivity] insert failed:', error);
    } catch (e) {
      console.error('[logActivity] unexpected error:', e);
    }
  };

  const getUserName = async (tenantId: string, userId: string, email?: string): Promise<string> => {
    // profiles is the live source of truth for a user's display name — team_members
    // is no longer written to anywhere (POST/PUT /api/team both write to profiles).
    const { data: me } = await supabaseAdmin.from('profiles').select('name').eq('id', userId).eq('tenant_id', tenantId).maybeSingle();
    return (me as any)?.name || email?.split('@')[0] || 'Utilisateur';
  };

  // Matches "@Full Name" against known tenant members — longest names first so
  // "Jean Dupont" isn't shadowed by a coincidental "Jean" member.
  const extractMentionedUserIds = (content: string, members: { id: string; name: string }[]): string[] => {
    const ids = new Set<string>();
    const candidates = members.filter(m => m.name?.trim()).sort((a, b) => b.name.length - a.name.length);
    for (const m of candidates) {
      const escaped = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`@${escaped}(?=[\\s.,!?;:]|$)`, 'u');
      if (re.test(content)) ids.add(m.id);
    }
    return [...ids];
  };

  const createMentionsForContent = async (
    tenantId: string, authorId: string, authorName: string, content: string,
    itemType: 'post' | 'comment', itemId: string, postId: string
  ) => {
    try {
      const { data: members } = await supabaseAdmin.from('profiles').select('id, name').eq('tenant_id', tenantId);
      const mentionedIds = extractMentionedUserIds(content, (members || []).filter((m: any) => m.id !== authorId));
      if (!mentionedIds.length) return;
      const rows = mentionedIds.map(uid => ({
        id: crypto.randomUUID(), tenant_id: tenantId, mentioned_user_id: uid,
        author_id: authorId, author_name: authorName, item_type: itemType, item_id: itemId, post_id: postId,
        content_snippet: content.slice(0, 200), created_at: new Date().toISOString()
      }));
      const { error } = await supabaseAdmin.from('mentions').insert(rows);
      if (error) console.error('[mentions] insert failed:', error);
    } catch (e) {
      console.error('[mentions] unexpected error:', e);
    }
  };

  app.get("/api/feed", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const [{ data: acts, error: actsError }, { data: posts, error: postsError }, { data: member }] = await Promise.all([
        supabaseAdmin.from('activities').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('feed_posts').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('team_members').select('notifications_last_seen').eq('auth_user_id', req.user.id).eq('tenant_id', tenantId).maybeSingle()
      ]);
      if (actsError) console.error('[GET /api/feed] activities query failed:', actsError);
      if (postsError) console.error('[GET /api/feed] feed_posts query failed:', postsError);

      const lastSeen = (member as any)?.notifications_last_seen || new Date(0).toISOString();

      // Fetch likes for current user
      const { data: myLikes } = await supabaseAdmin.from('feed_likes').select('item_id, item_type').eq('tenant_id', tenantId).eq('user_id', req.user.id);
      const likedSet = new Set((myLikes || []).map((l: any) => `${l.item_type}:${l.item_id}`));

      // Fetch comments per post
      const postIds = (posts || []).map((p: any) => p.id);
      const { data: allComments } = postIds.length
        ? await supabaseAdmin.from('feed_comments').select('*').in('post_id', postIds).order('created_at', { ascending: true })
        : { data: [] };

      // Items/comments that mention the requesting user, so the UI can surface them
      const { data: myMentions } = await supabaseAdmin.from('mentions').select('item_id').eq('tenant_id', tenantId).eq('mentioned_user_id', req.user.id);
      const mentionedItemIds = new Set((myMentions || []).map((m: any) => m.item_id));

      const feedItems = [
        ...(acts || []).map((a: any) => ({
          id: a.id,
          kind: 'activity',
          user_name: a.user_name,
          user_id: a.user_id,
          action: a.action,
          target: a.target,
          target_id: a.target_id,
          target_type: a.target_type,
          category: a.category,
          created_at: a.created_at,
          likes_count: a.likes_count || 0,
          liked: likedSet.has(`activity:${a.id}`),
          unread: a.created_at > lastSeen,
          comments: [],
          comments_count: 0
        })),
        ...(posts || []).map((p: any) => {
          const postComments = (allComments || []).filter((c: any) => c.post_id === p.id)
            .map((c: any) => ({ ...c, mentions_me: mentionedItemIds.has(c.id) }));
          return {
            id: p.id,
            kind: 'post',
            user_name: p.user_name,
            user_id: p.user_id,
            content: p.content,
            attachment_url: p.attachment_url,
            attachment_name: p.attachment_name,
            attachment_type: p.attachment_type,
            category: 'Messages',
            created_at: p.created_at,
            likes_count: p.likes_count || 0,
            liked: likedSet.has(`post:${p.id}`),
            unread: p.created_at > lastSeen,
            mentions_me: mentionedItemIds.has(p.id) || postComments.some((c: any) => c.mentions_me),
            comments: postComments,
            comments_count: postComments.length
          };
        })
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      res.json(feedItems);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch feed" });
    }
  });

  app.post("/api/feed/posts", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { content } = req.body;
      const file = req.file;
      if (!content?.trim() && !file) return res.status(400).json({ error: "Content required" });

      // Get user name
      const userName = await getUserName(tenantId, req.user.id, req.user.email);

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('feed-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const trimmedContent = content?.trim() || null;
      const { error: insertError } = await supabaseAdmin.from('feed_posts').insert({
        id, tenant_id: tenantId, user_id: req.user.id, user_name: userName, content: trimmedContent,
        attachment_url, attachment_name, attachment_type, created_at, likes_count: 0
      });
      if (insertError) throw insertError;
      if (trimmedContent) createMentionsForContent(tenantId, req.user.id, userName, trimmedContent, 'post', id, id);
      res.status(201).json({
        id, kind: 'post', user_name: userName, user_id: req.user.id, content: trimmedContent,
        attachment_url, attachment_name, attachment_type, created_at, likes_count: 0, liked: false, comments: [], comments_count: 0
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  app.post("/api/feed/posts/:id/like", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await supabaseAdmin.from('feed_likes').select('id').eq('item_id', id).eq('item_type', 'post').eq('user_id', req.user.id).eq('tenant_id', tenantId).maybeSingle();
      if (existing) {
        await supabaseAdmin.from('feed_likes').delete().eq('id', (existing as any).id);
        const { data: post } = await supabaseAdmin.from('feed_posts').select('likes_count').eq('id', id).single();
        const newCount = Math.max(0, ((post as any)?.likes_count || 1) - 1);
        await supabaseAdmin.from('feed_posts').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: false, likes_count: newCount });
      } else {
        await supabaseAdmin.from('feed_likes').insert({ id: crypto.randomUUID(), item_id: id, item_type: 'post', user_id: req.user.id, tenant_id: tenantId });
        const { data: post } = await supabaseAdmin.from('feed_posts').select('likes_count').eq('id', id).single();
        const newCount = ((post as any)?.likes_count || 0) + 1;
        await supabaseAdmin.from('feed_posts').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: true, likes_count: newCount });
      }
    } catch (err: any) {
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  app.post("/api/feed/activities/:id/like", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await supabaseAdmin.from('feed_likes').select('id').eq('item_id', id).eq('item_type', 'activity').eq('user_id', req.user.id).eq('tenant_id', tenantId).maybeSingle();
      if (existing) {
        await supabaseAdmin.from('feed_likes').delete().eq('id', (existing as any).id);
        const { data: act } = await supabaseAdmin.from('activities').select('likes_count').eq('id', id).single();
        const newCount = Math.max(0, ((act as any)?.likes_count || 1) - 1);
        await supabaseAdmin.from('activities').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: false, likes_count: newCount });
      } else {
        await supabaseAdmin.from('feed_likes').insert({ id: crypto.randomUUID(), item_id: id, item_type: 'activity', user_id: req.user.id, tenant_id: tenantId });
        const { data: act } = await supabaseAdmin.from('activities').select('likes_count').eq('id', id).single();
        const newCount = ((act as any)?.likes_count || 0) + 1;
        await supabaseAdmin.from('activities').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: true, likes_count: newCount });
      }
    } catch (err: any) {
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  app.post("/api/feed/posts/:id/comments", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { content } = req.body;
      const file = req.file;
      if (!content?.trim() && !file) return res.status(400).json({ error: "Content required" });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('feed-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const commentId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const trimmedContent = content?.trim() || null;
      const { error: insertError } = await supabaseAdmin.from('feed_comments').insert({
        id: commentId, post_id: id, tenant_id: tenantId, user_id: req.user.id, user_name: userName,
        content: trimmedContent, attachment_url, attachment_name, attachment_type, created_at
      });
      if (insertError) throw insertError;
      if (trimmedContent) createMentionsForContent(tenantId, req.user.id, userName, trimmedContent, 'comment', commentId, id);
      res.status(201).json({ id: commentId, post_id: id, user_name: userName, content: trimmedContent, attachment_url, attachment_name, attachment_type, created_at });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.get("/api/notifications/unread-count", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: member } = await supabaseAdmin.from('team_members').select('notifications_last_seen').eq('auth_user_id', req.user.id).eq('tenant_id', tenantId).maybeSingle();
      const lastSeen = (member as any)?.notifications_last_seen || new Date(0).toISOString();

      const [{ count: actCount }, { count: postCount }] = await Promise.all([
        supabaseAdmin.from('activities').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt('created_at', lastSeen),
        supabaseAdmin.from('feed_posts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt('created_at', lastSeen)
      ]);

      res.json({ count: (actCount || 0) + (postCount || 0) });
    } catch (err: any) {
      res.json({ count: 0 });
    }
  });

  app.post("/api/notifications/mark-read", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const now = new Date().toISOString();
      await supabaseAdmin.from('team_members').update({ notifications_last_seen: now }).eq('auth_user_id', req.user.id).eq('tenant_id', tenantId);
      res.json({ success: true, last_seen: now });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to mark notifications as read" });
    }
  });

  // ── End Activity Feed ───────────────────────────────────────────────────────

  // ── Profile (bio, CV, éducation, expérience, projets en cours) ──────────────

  app.get("/api/profile/:userId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { userId } = req.params;

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, email, role, job_title, department, phone, address, avatar, bio, cv_url, cv_filename')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) throw error;
      if (!profile) return res.status(404).json({ error: "Profil introuvable" });

      const [{ data: education }, { data: experience }, { data: memberships }] = await Promise.all([
        supabaseAdmin.from('profile_education').select('*').eq('user_id', userId).eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
        supabaseAdmin.from('profile_experience').select('*').eq('user_id', userId).eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
        supabaseAdmin.from('project_members').select('project_id, role, projects(name, status)').eq('user_id', userId).eq('tenant_id', tenantId),
      ]);

      const currentProjects = (memberships || [])
        .filter((m: any) => m.projects)
        .map((m: any) => ({ id: m.project_id, name: m.projects.name, status: m.projects.status, role: m.role }));

      res.json({
        ...profile,
        jobTitle: profile.job_title,
        education: education || [],
        experience: experience || [],
        current_projects: currentProjects,
        is_self: userId === req.user.id,
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.put("/api/profile", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { bio, job_title, department } = req.body;
      const { error } = await supabaseAdmin.from('profiles')
        .update({ bio, job_title, department })
        .eq('id', req.user.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/profile/cv", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const storagePath = `${tenantId}/${req.user.id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
      const url = await uploadToStorage('cv', storagePath, file.buffer, file.mimetype);
      await supabaseAdmin.from('profiles').update({ cv_url: url, cv_filename: file.originalname }).eq('id', req.user.id).eq('tenant_id', tenantId);
      res.json({ url, filename: file.originalname });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to upload CV" });
    }
  });

  app.delete("/api/profile/cv", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: profile } = await supabaseAdmin.from('profiles').select('cv_url').eq('id', req.user.id).eq('tenant_id', tenantId).maybeSingle();
      await supabaseAdmin.from('profiles').update({ cv_url: null, cv_filename: null }).eq('id', req.user.id).eq('tenant_id', tenantId);
      if ((profile as any)?.cv_url) deleteFromStorage('cv', (profile as any).cv_url).catch(() => {});
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to remove CV" });
    }
  });

  app.post("/api/profile/education", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { school, degree, field, start_year, end_year } = req.body;
      if (!school?.trim()) return res.status(400).json({ error: "L'établissement est requis" });
      const id = crypto.randomUUID();
      const { error } = await supabaseAdmin.from('profile_education').insert({
        id, tenant_id: tenantId, user_id: req.user.id, school: school.trim(), degree, field, start_year, end_year
      });
      if (error) throw error;
      res.status(201).json({ id, school, degree, field, start_year, end_year });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to add education entry" });
    }
  });

  app.put("/api/profile/education/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { school, degree, field, start_year, end_year } = req.body;
      const { error } = await supabaseAdmin.from('profile_education')
        .update({ school, degree, field, start_year, end_year })
        .eq('id', req.params.id).eq('user_id', req.user.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to update education entry" });
    }
  });

  app.delete("/api/profile/education/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('profile_education').delete()
        .eq('id', req.params.id).eq('user_id', req.user.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to delete education entry" });
    }
  });

  app.post("/api/profile/experience", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, company, start_date, end_date, description } = req.body;
      if (!title?.trim()) return res.status(400).json({ error: "L'intitulé du poste est requis" });
      const id = crypto.randomUUID();
      const { error } = await supabaseAdmin.from('profile_experience').insert({
        id, tenant_id: tenantId, user_id: req.user.id, title: title.trim(), company, start_date, end_date, description
      });
      if (error) throw error;
      res.status(201).json({ id, title, company, start_date, end_date, description });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to add experience entry" });
    }
  });

  app.put("/api/profile/experience/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, company, start_date, end_date, description } = req.body;
      const { error } = await supabaseAdmin.from('profile_experience')
        .update({ title, company, start_date, end_date, description })
        .eq('id', req.params.id).eq('user_id', req.user.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to update experience entry" });
    }
  });

  app.delete("/api/profile/experience/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('profile_experience').delete()
        .eq('id', req.params.id).eq('user_id', req.user.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to delete experience entry" });
    }
  });

  // ── End Profile ──────────────────────────────────────────────────────────────

  // ── Messagerie interne (conversations 1-à-1 et groupes) ─────────────────────

  const getProfileDisplayName = async (tenantId: string, userId: string): Promise<string> => {
    const { data } = await supabaseAdmin.from('profiles').select('name').eq('id', userId).eq('tenant_id', tenantId).maybeSingle();
    return (data as any)?.name || 'Utilisateur';
  };

  const assertParticipant = async (tenantId: string, conversationId: string, userId: string) => {
    const { data } = await supabaseAdmin.from('conversation_participants').select('id')
      .eq('conversation_id', conversationId).eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle();
    if (!data) {
      const err: any = new Error("Vous ne participez pas à cette conversation");
      err.status = 403;
      throw err;
    }
  };

  app.get("/api/conversations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: myParticipations } = await supabaseAdmin.from('conversation_participants')
        .select('conversation_id, last_read_at').eq('user_id', req.user.id).eq('tenant_id', tenantId);
      const convIds = (myParticipations || []).map((p: any) => p.conversation_id);
      if (!convIds.length) return res.json([]);

      const lastReadByConv = new Map((myParticipations || []).map((p: any) => [p.conversation_id, p.last_read_at]));

      const [{ data: conversations }, { data: allParticipants }] = await Promise.all([
        supabaseAdmin.from('conversations').select('*').in('id', convIds).order('last_message_at', { ascending: false }),
        supabaseAdmin.from('conversation_participants').select('conversation_id, user_id, profiles(id, name, avatar)').in('conversation_id', convIds),
      ]);

      const result = await Promise.all((conversations || []).map(async (conv: any) => {
        const participants = (allParticipants || []).filter((p: any) => p.conversation_id === conv.id);
        const others = participants.filter((p: any) => p.user_id !== req.user.id).map((p: any) => p.profiles).filter(Boolean);

        const { data: lastMsg } = await supabaseAdmin.from('messages').select('content, attachment_name, sender_name, created_at')
          .eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

        const lastRead = lastReadByConv.get(conv.id) || new Date(0).toISOString();
        const { count: unreadCount } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id).neq('sender_id', req.user.id).gt('created_at', lastRead);

        const displayName = conv.is_group ? (conv.name || 'Groupe') : (others[0]?.name || 'Utilisateur');
        const displayAvatar = conv.is_group ? null : (others[0]?.avatar || null);

        return {
          id: conv.id,
          is_group: conv.is_group,
          name: displayName,
          avatar: displayAvatar,
          participants: participants.map((p: any) => p.profiles).filter(Boolean),
          last_message: (lastMsg as any)?.content || ((lastMsg as any)?.attachment_name ? `📎 ${(lastMsg as any).attachment_name}` : null),
          last_message_at: conv.last_message_at,
          unread_count: unreadCount || 0,
        };
      }));

      res.json(result.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.post("/api/conversations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { participant_ids, is_group, name } = req.body;
      const otherIds: string[] = (participant_ids || []).filter((id: string) => id && id !== req.user.id);
      if (!otherIds.length) return res.status(400).json({ error: "Au moins un destinataire est requis" });

      // Reuse the existing 1:1 conversation instead of creating a duplicate
      if (!is_group && otherIds.length === 1) {
        const { data: myConvs } = await supabaseAdmin.from('conversation_participants').select('conversation_id').eq('user_id', req.user.id).eq('tenant_id', tenantId);
        const myConvIds = (myConvs || []).map((c: any) => c.conversation_id);
        if (myConvIds.length) {
          const { data: theirConvs } = await supabaseAdmin.from('conversation_participants').select('conversation_id').eq('user_id', otherIds[0]).eq('tenant_id', tenantId).in('conversation_id', myConvIds);
          for (const tc of theirConvs || []) {
            const { data: conv } = await supabaseAdmin.from('conversations').select('id, is_group').eq('id', (tc as any).conversation_id).eq('tenant_id', tenantId).maybeSingle();
            if (conv && !(conv as any).is_group) {
              return res.json({ id: (conv as any).id, existing: true });
            }
          }
        }
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error: convErr } = await supabaseAdmin.from('conversations').insert({
        id, tenant_id: tenantId, is_group: !!is_group, name: is_group ? (name || 'Groupe') : null, created_by: req.user.id, created_at: now, last_message_at: now
      });
      if (convErr) throw convErr;

      const participantRows = [req.user.id, ...otherIds].map(uid => ({
        id: crypto.randomUUID(), tenant_id: tenantId, conversation_id: id, user_id: uid, last_read_at: now, joined_at: now
      }));
      const { error: partErr } = await supabaseAdmin.from('conversation_participants').insert(participantRows);
      if (partErr) throw partErr;

      res.status(201).json({ id, existing: false });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.get("/api/conversations/:id/messages", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      await assertParticipant(tenantId, id, req.user.id);
      const { data, error } = await supabaseAdmin.from('messages').select('*').eq('conversation_id', id).eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || "Failed to fetch messages" });
    }
  });

  app.post("/api/conversations/:id/messages", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      await assertParticipant(tenantId, id, req.user.id);
      const { content } = req.body;
      const file = req.file;
      if (!content?.trim() && !file) return res.status(400).json({ error: "Message vide" });

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('message-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const senderName = await getProfileDisplayName(tenantId, req.user.id);
      const msgId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('messages').insert({
        id: msgId, tenant_id: tenantId, conversation_id: id, sender_id: req.user.id, sender_name: senderName,
        content: content?.trim() || null, attachment_url, attachment_name, attachment_type, created_at
      });
      if (error) throw error;
      await supabaseAdmin.from('conversations').update({ last_message_at: created_at }).eq('id', id).eq('tenant_id', tenantId);
      // Sending counts as having read the thread up to now
      await supabaseAdmin.from('conversation_participants').update({ last_read_at: created_at }).eq('conversation_id', id).eq('user_id', req.user.id).eq('tenant_id', tenantId);

      res.status(201).json({
        id: msgId, conversation_id: id, sender_id: req.user.id, sender_name: senderName,
        content: content?.trim() || null, attachment_url, attachment_name, attachment_type, created_at
      });
    } catch (e: any) {
      console.error(e);
      res.status(e.status || 500).json({ error: e.message || "Failed to send message" });
    }
  });

  app.post("/api/conversations/:id/read", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const now = new Date().toISOString();
      await supabaseAdmin.from('conversation_participants').update({ last_read_at: now })
        .eq('conversation_id', id).eq('user_id', req.user.id).eq('tenant_id', tenantId);
      res.json({ success: true, last_read_at: now });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to mark conversation as read" });
    }
  });

  app.get("/api/messages/unread-count", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: myParticipations } = await supabaseAdmin.from('conversation_participants')
        .select('conversation_id, last_read_at').eq('user_id', req.user.id).eq('tenant_id', tenantId);
      const counts = await Promise.all((myParticipations || []).map(async (p: any) => {
        const { count } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id).neq('sender_id', req.user.id).gt('created_at', p.last_read_at);
        return count || 0;
      }));
      res.json({ count: counts.reduce((a, b) => a + b, 0) });
    } catch (e: any) {
      res.json({ count: 0 });
    }
  });

  app.post("/api/conversations/:id/participants", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      await assertParticipant(tenantId, id, req.user.id);
      const { data: conv } = await supabaseAdmin.from('conversations').select('is_group').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if (!(conv as any)?.is_group) return res.status(400).json({ error: "Impossible d'ajouter des participants à une conversation 1-à-1" });
      const { user_ids } = req.body;
      const now = new Date().toISOString();
      const rows = (user_ids || []).map((uid: string) => ({
        id: crypto.randomUUID(), tenant_id: tenantId, conversation_id: id, user_id: uid, last_read_at: now, joined_at: now
      }));
      if (rows.length) await supabaseAdmin.from('conversation_participants').upsert(rows, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || "Failed to add participants" });
    }
  });

  app.delete("/api/conversations/:id/participants/:userId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id, userId } = req.params;
      // Anyone can leave; only self-removal is allowed for now (no group admin concept yet)
      if (userId !== req.user.id) return res.status(403).json({ error: "Vous ne pouvez retirer que vous-même du groupe" });
      await supabaseAdmin.from('conversation_participants').delete().eq('conversation_id', id).eq('user_id', userId).eq('tenant_id', tenantId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to leave conversation" });
    }
  });

  // ── End Messagerie ───────────────────────────────────────────────────────────

  app.post("/api/send-email", async (req: any, res: any) => {
    try {
      const { to, subject, text, html, attachments, userEmail } = req.body;

      // Get settings from Supabase
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!settings) {
        return res.status(500).json({ error: "Settings not found" });
      }

      const smtpHost = (settings as any).smtpHost || process.env.SMTP_HOST;
      const smtpPort = (settings as any).smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = (settings as any).smtpUser || process.env.SMTP_USER;
      const smtpPass = (settings as any).smtpPass || process.env.SMTP_PASS;

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

      const from = (settings as any).senderOption === 'personal' ? userEmail : (settings as any).email;
      const cc = (settings as any).senderOption === 'personal' ? (settings as any).email : undefined;

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

  app.get("/api/projects/:projectId/reports", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: reports, error } = await supabaseAdmin.from('site_reports').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).order('date', { ascending: false });
      if (error) throw error;
      const parsedReports = (reports || []).map((report: any) => ({
        ...report,
        stakeholders: Array.isArray(report.stakeholders) ? report.stakeholders : (() => { try { return report.stakeholders ? JSON.parse(report.stakeholders) : []; } catch (e) { return []; } })(),
        companies: Array.isArray(report.companies) ? report.companies : (() => { try { return report.companies ? JSON.parse(report.companies) : []; } catch (e) { return []; } })()
      }));
      res.json(parsedReports);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/projects/:projectId/reports", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { date, report_number } = req.body;
      const id = crypto.randomUUID();
      const { error: insErr } = await supabaseAdmin.from('site_reports').insert({ id, tenant_id: tenantId, project_id: projectId, date, report_number });
      if (insErr) throw insErr;
      const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
      const projectName = (project as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du compte-rendu de chantier N° ${report_number} (${projectName})`, projectName, id, 'site_report', 'Notes de site');
      // Copy open notes from previous report
      const { data: previousReports } = await supabaseAdmin.from('site_reports').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).neq('id', id).order('date', { ascending: false }).limit(1);
      if (previousReports && previousReports.length > 0) {
        const prevId = previousReports[0].id;
        const { data: openNotes } = await supabaseAdmin.from('site_report_notes').select('*').eq('report_id', prevId).eq('status', 'open');
        if (openNotes && openNotes.length > 0) {
          const newNotes = openNotes.map((note: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, report_id: id, category: note.category, note_number: note.note_number, responsible_company: note.responsible_company, issue_date: note.issue_date, due_date: note.due_date, status: 'open' }));
          await supabaseAdmin.from('site_report_notes').insert(newNotes);
        }
      }
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create report" });
    }
  });

  app.get("/api/reports/:reportId/notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { data: notes, error } = await supabaseAdmin.from('site_report_notes').select('*').eq('report_id', reportId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  app.post("/api/reports/:reportId/notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { category, note_number, responsible_company, issue_date, due_date } = req.body;
      const id = crypto.randomUUID();
      const { error } = await supabaseAdmin.from('site_report_notes').insert({ id, tenant_id: tenantId, report_id: reportId, category, note_number, responsible_company, issue_date, due_date });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ajout de la note de chantier N° ${note_number}`, category || '', id, 'site_report_note', 'Notes de site');
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  app.put("/api/reports/:reportId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { pageFormat, stakeholders, companies, meetingNotes, nextMeeting } = req.body;
      const { error } = await supabaseAdmin.from('site_reports').update({
        pageFormat: pageFormat || null,
        stakeholders: stakeholders || [],
        companies: companies || [],
        meetingNotes: meetingNotes || null,
        nextMeeting: nextMeeting || null
      }).eq('id', reportId).eq('tenant_id', tenantId);
      if (error) throw error;
      const { data: updatedReport } = await supabaseAdmin.from('site_reports').select('*').eq('id', reportId).single();
      res.json({ ...(updatedReport as any), stakeholders: (updatedReport as any)?.stakeholders || [], companies: (updatedReport as any)?.companies || [] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update report" });
    }
  });

  app.put("/api/notes/:noteId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { noteId } = req.params;
      const { category, responsible_company, text, status, due_date, realization_date } = req.body;
      const { error } = await supabaseAdmin.from('site_report_notes').update({ category, responsible_company, text, status, due_date, realization_date }).eq('id', noteId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:noteId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { noteId } = req.params;
      const { data: note } = await supabaseAdmin.from('site_report_notes').select('note_number, category').eq('id', noteId).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('site_report_notes').delete().eq('id', noteId).eq('tenant_id', tenantId);
      if (error) throw error;
      const noteNumber = (note as any)?.note_number;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la note de chantier N° ${noteNumber}`, (note as any)?.category || '', noteId, 'site_report_note', 'Notes de site');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // --- Observations routes ---

  app.get("/api/projects/:projectId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data, error } = await supabaseAdmin
        .from('observations')
        .select(`*, lot:project_lots(id,lot_number,lot_title), created_report:site_reports!created_report_id(report_number), resolved_report:site_reports!resolved_report_id(report_number), observation_reports(report_id)`)
        .eq('project_id', projectId).eq('tenant_id', tenantId)
        .order('number', { ascending: true });
      if (error) throw error;
      const mapped = (data || []).map((o: any) => ({
        ...o,
        created_report_number: o.created_report?.report_number,
        resolved_report_number: o.resolved_report?.report_number,
        report_ids: (o.observation_reports || []).map((r: any) => r.report_id),
      }));
      res.json(mapped);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch observations" });
    }
  });

  app.post("/api/projects/:projectId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { lot_id, contact_id, texte, statut, due_date, created_report_id } = req.body;
      const { data: existing } = await supabaseAdmin.from('observations').select('number').eq('project_id', projectId).eq('tenant_id', tenantId).order('number', { ascending: false }).limit(1);
      const number = existing && existing.length > 0 ? ((existing[0] as any).number || 0) + 1 : 1;
      const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const { data, error } = await supabaseAdmin.from('observations').insert({
        id, tenant_id: tenantId, project_id: projectId, lot_id: lot_id || null, contact_id: contact_id || null,
        texte: texte || '', statut: statut || 'À faire', due_date: due_date || null,
        created_report_id: created_report_id || null, number
      }).select().single();
      if (error) throw error;
      if (created_report_id) {
        await supabaseAdmin.from('observation_reports').insert({ observation_id: id, report_id: created_report_id });
      }
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'observation N° ${number}`, texte || '', id, 'observation', 'Réserves/Observations');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to create observation" });
    }
  });

  app.put("/api/observations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { lot_id, contact_id, texte, statut, due_date, resolved_report_id } = req.body;
      const update: any = { lot_id: lot_id || null, contact_id: contact_id || null, texte, statut, due_date: due_date || null };
      if (statut === 'Levée' && resolved_report_id) update.resolved_report_id = resolved_report_id;
      const { error } = await supabaseAdmin.from('observations').update(update).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update observation" });
    }
  });

  app.delete("/api/observations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: obs } = await supabaseAdmin.from('observations').select('number, texte').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('observations').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'observation N° ${(obs as any)?.number}`, (obs as any)?.texte || '', id, 'observation', 'Réserves/Observations');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete observation" });
    }
  });

  app.get("/api/reports/:reportId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { data, error } = await supabaseAdmin
        .from('observations')
        .select(`*, lot:project_lots(id,lot_number,lot_title), created_report:site_reports!created_report_id(report_number), resolved_report:site_reports!resolved_report_id(report_number), observation_reports!inner(report_id)`)
        .eq('tenant_id', tenantId)
        .eq('observation_reports.report_id', reportId)
        .order('number', { ascending: true });
      if (error) throw error;
      const mapped = (data || []).map((o: any) => ({
        ...o,
        created_report_number: o.created_report?.report_number,
        resolved_report_number: o.resolved_report?.report_number,
        report_ids: (o.observation_reports || []).map((r: any) => r.report_id),
      }));
      res.json(mapped);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch report observations" });
    }
  });

  app.post("/api/observations/:id/link/:reportId", async (req: any, res: any) => {
    try {
      await supabaseAdmin.from('observation_reports').insert({ observation_id: req.params.id, report_id: req.params.reportId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to link observation to report" });
    }
  });

  // --- End Observations routes ---

  app.get("/api/projects/:projectId/cctp", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: cctp, error } = await supabaseAdmin.from('cctps').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (cctp) {
        res.json(typeof (cctp as any).data === 'string' ? JSON.parse((cctp as any).data) : (cctp as any).data);
      } else {
        res.status(404).json({ error: "CCTP not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch CCTP" });
    }
  });

  app.post("/api/projects/:projectId/cctp", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? crypto.randomUUID() : (data.id || crypto.randomUUID());
      data.id = id;
      const { data: existing } = await supabaseAdmin.from('cctps').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('cctps').update({ data: JSON.stringify(data) }).eq('project_id', projectId).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('cctps').insert({ id, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(data) });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to save CCTP" });
    }
  });

  app.get("/api/projects/:projectId/dpgf", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: dpgf, error } = await supabaseAdmin.from('dpgfs').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (dpgf) {
        res.json(typeof (dpgf as any).data === 'string' ? JSON.parse((dpgf as any).data) : (dpgf as any).data);
      } else {
        res.status(404).json({ error: "DPGF not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DPGF" });
    }
  });

  app.post("/api/projects/:projectId/dpgf", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? crypto.randomUUID() : (data.id || crypto.randomUUID());
      data.id = id;
      const { data: existing } = await supabaseAdmin.from('dpgfs').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('dpgfs').update({ data: JSON.stringify(data) }).eq('project_id', projectId).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('dpgfs').insert({ id, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(data) });
        const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
        const projectName = (project as any)?.name || '';
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Création du DPGF du projet "${projectName}"`, projectName, id, 'dpgf', 'Situations/DPGF');
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to save DPGF" });
    }
  });

  // camelCase (frontend) ↔ snake_case (Supabase settings table)
  const toSnake: Record<string, string> = {
    agencyName: 'agency_name', vatNumber: 'vat_number',
    senderOption: 'sender_option', defaultEmailTemplate: 'default_email_template',
    logoUrl: 'logo_url', smtpHost: 'smtp_host', smtpPort: 'smtp_port',
    smtpUser: 'smtp_user', smtpPass: 'smtp_pass',
    numPrefixDevis: 'num_prefix_devis',
    numPrefixFacture: 'num_prefix_facture',
    numPrefixHonoraires: 'num_prefix_honoraires',
  };
  const toCamel: Record<string, string> = Object.fromEntries(Object.entries(toSnake).map(([k, v]) => [v, k]));

  app.get("/api/settings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!settings) { res.json({ tenant_id: tenantId }); return; }
      // Return camelCase keys expected by the frontend
      const out: any = {};
      for (const [k, v] of Object.entries(settings)) {
        out[toCamel[k] ?? k] = v;
      }
      res.json(out);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const data = req.body;
      // Convert camelCase → snake_case
      const snakeData: any = {};
      for (const [k, v] of Object.entries(data)) {
        const col = toSnake[k] ?? k;
        snakeData[col] = v;
      }
      // Only keep valid table columns (exclude id — managed separately)
      const validCols = new Set([
        'agency_name', 'address', 'phone', 'email', 'siret', 'vat_number',
        'currency', 'language', 'sender_option', 'default_email_template', 'logo_url',
        'seller_iban', 'seller_bic',
        'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
        'zoho_client_id', 'zoho_client_secret', 'zoho_org_id', 'zoho_data_center', 'zoho_refresh_token',
        'zoho_books_org_id',
        'num_prefix_devis', 'num_prefix_facture', 'num_prefix_honoraires',
        'maf_enabled', 'maf_numero_adherent', 'maf_taux_contrat_permil', 'maf_declaration_year',
        'ragic_api_key', 'ragic_account',
        'ragic_sheet_contacts', 'ragic_sheet_projects', 'ragic_sheet_invoices', 'ragic_sheet_proposals',
        'odoo_url', 'odoo_db', 'odoo_username', 'odoo_api_key',
        'superpdp_client_id', 'superpdp_client_secret', 'superpdp_sandbox',
        'chorus_pro_piste_client_id', 'chorus_pro_piste_client_secret',
        'chorus_pro_technical_login', 'chorus_pro_technical_password', 'chorus_pro_sandbox',
      ]);
      const numericCols = new Set(['maf_taux_contrat_permil', 'maf_declaration_year']);
      const filteredData: any = Object.fromEntries(
        Object.entries(snakeData)
          .filter(([k]) => validCols.has(k))
          .map(([k, v]) => [k, numericCols.has(k) && v === '' ? null : v])
      );

      if (Object.keys(filteredData).length === 0) { res.json({ success: true }); return; }

      // Check if row already exists for this tenant
      const { data: existing } = await supabaseAdmin
        .from('settings')
        .select('id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      // A column can be in validCols (known to this server build) but still missing from
      // the DB if its migration hasn't been applied there yet (has happened before — see
      // PR #55). Rather than hard-failing the whole save, drop the offending column(s)
      // reported by Postgres and retry, so unrelated fields still get saved.
      const droppedCols: string[] = [];
      let saveError: any;
      for (let attempt = 0; attempt < 20 && Object.keys(filteredData).length > 0; attempt++) {
        if (existing) {
          const { error } = await supabaseAdmin
            .from('settings')
            .update(filteredData)
            .eq('tenant_id', tenantId);
          saveError = error;
        } else {
          const { error } = await supabaseAdmin
            .from('settings')
            .insert({ ...filteredData, id: crypto.randomUUID(), tenant_id: tenantId });
          saveError = error;
        }
        if (!saveError) break;
        const missingCol = saveError.code === '42703' ? /column "([^"]+)"/.exec(saveError.message)?.[1] : undefined;
        if (!missingCol || !(missingCol in filteredData)) break;
        delete filteredData[missingCol];
        droppedCols.push(missingCol);
      }
      if (droppedCols.length) {
        console.warn(`[Settings] Column(s) missing in DB, migration likely pending — dropped from save: ${droppedCols.join(', ')}`);
      }

      if (saveError) throw saveError;
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating settings:", error);
      res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to update settings: " + error.message });
    }
  });

  // Upload agency logo → save to Supabase Storage, update settings.logo_url
  app.post("/api/upload/logo", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const ext = file.originalname.split('.').pop() || 'png';
      const storagePath = `${tenantId}/logo/${Date.now()}.${ext}`;
      // Ensure logos bucket exists
      const { data: bucketData } = await supabaseAdmin.storage.getBucket('logos');
      if (!bucketData) {
        await supabaseAdmin.storage.createBucket('logos', { public: true, fileSizeLimit: 5242880 });
      }
      const url = await uploadToStorage('logos', storagePath, file.buffer, file.mimetype);
      // Persist to settings
      const { data: existing } = await supabaseAdmin.from('settings').select('tenant_id').eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('settings').update({ logo_url: url }).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('settings').insert({ id: tenantId, tenant_id: tenantId, logo_url: url });
      }
      res.json({ url });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message || "Upload failed" }); }
  });

  // Upload user avatar → save to Supabase Storage, update profile.avatar
  app.post("/api/upload/avatar", upload.single('file'), async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const ext = file.originalname.split('.').pop() || 'png';
      const storagePath = `avatars/${userId}/${Date.now()}.${ext}`;
      const { data: bucketData } = await supabaseAdmin.storage.getBucket('logos');
      if (!bucketData) {
        await supabaseAdmin.storage.createBucket('logos', { public: true, fileSizeLimit: 5242880 });
      }
      const url = await uploadToStorage('logos', storagePath, file.buffer, file.mimetype);
      await supabaseAdmin.from('profiles').update({ avatar: url }).eq('id', userId);
      res.json({ url });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message || "Upload failed" }); }
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
        from: `"ArchiOffice Test" <${smtpUser}>`,
        to: smtpUser,
        subject: "ArchiOffice SMTP Test",
        text: "This is a test email from ArchiOffice to verify your SMTP configuration.",
        html: "<b>This is a test email from ArchiOffice to verify your SMTP configuration.</b>"
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("SMTP Test Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/lots", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: lots, error } = await supabaseAdmin.from('project_lots').select('*').eq('project_id', projectId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json(lots);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  app.post("/api/projects/:projectId/lots", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { id: bodyId, lot_number, lot_title } = req.body;
      const lotId = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('project_lots').insert({ id: lotId, tenant_id: tenantId, project_id: projectId, lot_number, lot_title });
      if (error) throw error;
      res.status(201).json({ id: lotId });
    } catch (error) {
      res.status(500).json({ error: "Failed to create lot" });
    }
  });

  app.delete("/api/lots/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_lots').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
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
  app.get('/api/zoho/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_org_id, zoho_data_center, zoho_refresh_token').eq('tenant_id', tenantId).single();
      res.json({
        connected: !!(settings as any)?.zoho_refresh_token,
        has_credentials: !!((settings as any)?.zoho_client_id && (settings as any)?.zoho_client_secret && (settings as any)?.zoho_org_id),
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
  app.get('/api/zoho/auth', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_client_id || !(settings as any)?.zoho_client_secret || !(settings as any)?.zoho_org_id) {
        return res.status(400).send('Veuillez d\'abord enregistrer vos identifiants Zoho dans les Paramètres.');
      }
      const dc = (settings as any).zoho_data_center || 'com';
      const redirectUri = getZohoRedirectUri(req);
      const scope = 'ZohoInvoice.invoices.READ,ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.UPDATE,ZohoInvoice.contacts.READ,ZohoInvoice.contacts.CREATE';
      const authUrl = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
      authUrl.searchParams.set('client_id', (settings as any).zoho_client_id);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      // Store tenantId in state param for callback
      authUrl.searchParams.set('state', tenantId);
      res.redirect(authUrl.toString());
    } catch (error) {
      res.status(500).send('Erreur lors de la connexion à Zoho');
    }
  });

  // GET /api/zoho/callback  — Zoho redirects here after user grants access
  app.get('/api/zoho/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state: tenantId } = req.query as any;
    if (oauthError || !code || !tenantId) {
      return res.redirect('/settings?zoho_error=1');
    }
    try {
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const dc = (settings as any)?.zoho_data_center || 'com';
      const redirectUri = getZohoRedirectUri(req);
      const params = new URLSearchParams({
        code,
        client_id: (settings as any).zoho_client_id,
        client_secret: (settings as any).zoho_client_secret,
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
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: refresh_token }).eq('tenant_id', tenantId);
      res.redirect('/settings?zoho_connected=1');
    } catch (error: any) {
      console.error('[Zoho callback error]', error.message);
      res.redirect('/settings?zoho_error=1');
    }
  });

  // DELETE /api/zoho/disconnect
  app.delete('/api/zoho/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      zohoAccessTokenCache = null;
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: null }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Zoho', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to disconnect Zoho' });
    }
  });

  // POST /api/zoho/sync  — bidirectional sync
  app.post('/api/zoho/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_refresh_token) {
        return res.status(400).json({ error: 'Zoho non connecté. Veuillez vous connecter dans les Paramètres.' });
      }

      const accessToken = await getZohoAccessToken(settings);
      const dc = (settings as any).zoho_data_center || 'com';
      const apiBase = `https://invoice.zoho.${dc}/api/v3`;
      const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'X-com-zoho-invoice-organizationid': (settings as any).zoho_org_id,
        'Content-Type': 'application/json',
      };

      const errors: string[] = [];
      let pushed = 0;
      let pulled = 0;

      // 1. Push local invoices not yet in Zoho
      const { data: localInvoices } = await supabaseAdmin.from('invoices').select('*, projects(name)').eq('tenant_id', tenantId).or('zoho_invoice_id.is.null,zoho_invoice_id.eq.');
      const invoicesArr = (localInvoices || []).map((inv: any) => ({ ...inv, project_name: inv.projects?.name || null }));

      for (const inv of invoicesArr) {
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
            await supabaseAdmin.from('invoices').update({ zoho_invoice_id: zohoId }).eq('id', inv.id).eq('tenant_id', tenantId);
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
          const { data: local } = await supabaseAdmin.from('invoices').select('id, status').eq('zoho_invoice_id', zohoInv.invoice_id).eq('tenant_id', tenantId).single();
          if (local) {
            const newStatus = mapZohoStatus(zohoInv.status);
            if (newStatus && newStatus !== (local as any).status) {
              await supabaseAdmin.from('invoices').update({ status: newStatus }).eq('id', (local as any).id).eq('tenant_id', tenantId);
              pulled++;
            }
          }
        }
      } catch (err: any) {
        errors.push(`Récupération échouée: ${err.response?.data?.message || err.message}`);
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Zoho (${pushed} envoyée(s), ${pulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ pushed, pulled, errors });
    } catch (error: any) {
      console.error('[Zoho sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });

  // ─── End Zoho Invoice Integration ──────────────────────────────────────────

  // ─── Zoho Books Integration ────────────────────────────────────────────────

  let zohoBooksAccessTokenCache: { token: string; expiresAt: number } | null = null;

  async function getZohoBooksAccessToken(settings: any): Promise<string> {
    const now = Date.now();
    if (zohoBooksAccessTokenCache && zohoBooksAccessTokenCache.expiresAt > now + 60000) {
      return zohoBooksAccessTokenCache.token;
    }
    const dc = settings.zoho_data_center || 'com';
    const params = new URLSearchParams({
      refresh_token: settings.zoho_refresh_token,
      client_id: settings.zoho_client_id,
      client_secret: settings.zoho_client_secret,
      grant_type: 'refresh_token',
    });
    const tokenRes = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: 'POST', body: params });
    const { access_token, expires_in } = await tokenRes.json() as any;
    if (!access_token) throw new Error('Failed to refresh Zoho Books access token');
    zohoBooksAccessTokenCache = { token: access_token, expiresAt: now + (expires_in || 3600) * 1000 };
    return access_token;
  }

  function getZohoBooksCallbackUrl(req: any): string {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/api/zoho-books/callback`;
  }

  // GET /api/zoho-books/status
  app.get('/api/zoho-books/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_org_id, zoho_books_org_id, zoho_data_center, zoho_refresh_token').eq('tenant_id', tenantId).single();
      res.json({
        connected: !!(settings as any)?.zoho_refresh_token,
        has_credentials: !!((settings as any)?.zoho_client_id && (settings as any)?.zoho_client_secret && ((settings as any)?.zoho_books_org_id || (settings as any)?.zoho_org_id)),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/zoho-books/auth  — redirects browser to Zoho OAuth consent screen (Books scope)
  app.get('/api/zoho-books/auth', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_data_center').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_client_id) {
        return res.status(400).json({ error: 'Zoho credentials not configured' });
      }
      const dc = (settings as any).zoho_data_center || 'com';
      const redirectUri = getZohoBooksCallbackUrl(req);
      const authUrl = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
      authUrl.searchParams.set('client_id', (settings as any).zoho_client_id);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'ZohoBooks.fullaccess.all');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      res.redirect(authUrl.toString());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/zoho-books/callback  — Zoho redirects here after user grants access
  app.get('/api/zoho-books/callback', async (req: any, res: any) => {
    const { code, error: oauthError } = req.query as any;
    if (oauthError || !code) return res.redirect('/settings?zoho_books_error=1');
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_data_center').eq('tenant_id', tenantId).single();
      const dc = (settings as any)?.zoho_data_center || 'com';
      const redirectUri = getZohoBooksCallbackUrl(req);
      const params = new URLSearchParams({
        code, client_id: (settings as any).zoho_client_id,
        client_secret: (settings as any).zoho_client_secret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      const tokenRes = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: 'POST', body: params });
      const { refresh_token } = await tokenRes.json() as any;
      if (!refresh_token) return res.redirect('/settings?zoho_books_error=1');
      zohoBooksAccessTokenCache = null;
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: refresh_token }).eq('tenant_id', tenantId);
      res.redirect('/settings?zoho_books_connected=1');
    } catch {
      res.redirect('/settings?zoho_books_error=1');
    }
  });

  // DELETE /api/zoho-books/disconnect
  app.delete('/api/zoho-books/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      zohoBooksAccessTokenCache = null;
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: null }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Zoho Books', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/zoho-books/sync  — sync invoices/estimates with Zoho Books
  app.post('/api/zoho-books/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_refresh_token) {
        return res.status(400).json({ error: 'Zoho Books non connecté' });
      }
      const dc = (settings as any).zoho_data_center || 'com';
      const orgId = (settings as any).zoho_books_org_id || (settings as any).zoho_org_id;
      const apiBase = `https://books.zoho.${dc}/api/v3`;
      const accessToken = await getZohoBooksAccessToken(settings as any);
      const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      };

      let pushed = 0, pulled = 0;
      const errors: string[] = [];

      // Push local invoices not yet in Zoho Books
      try {
        const { data: localInvoices } = await supabaseAdmin
          .from('invoices')
          .select('*, projects(name)')
          .eq('tenant_id', tenantId)
          .or('zoho_invoice_id.is.null,zoho_invoice_id.eq.');

        for (const inv of (localInvoices || [])) {
          try {
            const payload = {
              customer_name: (inv as any).client_name || 'Client',
              invoice_number: (inv as any).number || (inv as any).id,
              date: (inv as any).date || new Date().toISOString().split('T')[0],
              due_date: (inv as any).due_date,
              line_items: [{ name: `Facture ${(inv as any).number || (inv as any).id}`, rate: (inv as any).amount || 0, quantity: 1 }],
            };
            const resp = await fetch(`${apiBase}/invoices?organization_id=${orgId}`, {
              method: 'POST', headers, body: JSON.stringify(payload),
            });
            const respData = await resp.json() as any;
            const zohoId = respData?.invoice?.invoice_id;
            if (zohoId) {
              await supabaseAdmin.from('invoices').update({ zoho_invoice_id: zohoId }).eq('id', (inv as any).id).eq('tenant_id', tenantId);
              pushed++;
            } else if (respData?.message) {
              errors.push(`Push ${(inv as any).id}: ${respData.message}`);
            }
          } catch (err: any) {
            errors.push(`Push ${(inv as any).id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        errors.push(`Envoi échoué: ${err.message}`);
      }

      // Pull status updates from Zoho Books
      try {
        const resp = await fetch(`${apiBase}/invoices?organization_id=${orgId}&status=all`, { headers });
        const respData = await resp.json() as any;
        const zohoInvoices: any[] = respData?.invoices || [];
        for (const zohoInv of zohoInvoices) {
          const { data: local } = await supabaseAdmin.from('invoices').select('id, status').eq('zoho_invoice_id', zohoInv.invoice_id).eq('tenant_id', tenantId).single();
          if (local) {
            const statusMap: Record<string, string> = { paid: 'paid', sent: 'sent', draft: 'draft', overdue: 'overdue', void: 'cancelled' };
            const newStatus = statusMap[zohoInv.status] ?? null;
            if (newStatus && newStatus !== (local as any).status) {
              await supabaseAdmin.from('invoices').update({ status: newStatus }).eq('id', (local as any).id).eq('tenant_id', tenantId);
              pulled++;
            }
          }
        }
      } catch (err: any) {
        errors.push(`Récupération échouée: ${err.message}`);
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Zoho Books (${pushed} envoyée(s), ${pulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ pushed, pulled, errors });
    } catch (error: any) {
      console.error('[Zoho Books sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });

  // ─── End Zoho Books Integration ────────────────────────────────────────────

  // ─── Ragic Integration ─────────────────────────────────────────────────────

  function ragicHeaders(apiKey: string) {
    return {
      Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
      'Content-Type': 'application/json',
    };
  }

  function ragicUrl(account: string, sheet: string, recordId?: string | number) {
    const base = `https://${account}.ragic.com/${sheet}`;
    return recordId != null ? `${base}/${recordId}` : base;
  }

  // GET /api/ragic/status
  app.get('/api/ragic/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('ragic_api_key,ragic_account').eq('tenant_id', tenantId).single();
      const connected = !!(settings as any)?.ragic_api_key && !!(settings as any)?.ragic_account;
      res.json({ connected });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/ragic/disconnect
  app.delete('/api/ragic/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({
        ragic_api_key: null,
        ragic_account: null,
        ragic_sheet_contacts: null,
        ragic_sheet_projects: null,
        ragic_sheet_invoices: null,
        ragic_sheet_proposals: null,
      }).eq('tenant_id', tenantId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/ragic/sync  — bidirectional sync for contacts, projects, invoices, proposals
  app.post('/api/ragic/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const s = settings as any;
      if (!s?.ragic_api_key || !s?.ragic_account) {
        return res.status(400).json({ error: 'Ragic non configuré. Veuillez renseigner la clé API et le compte dans les Paramètres.' });
      }

      const hdrs = ragicHeaders(s.ragic_api_key);
      const results: Record<string, { pushed: number; pulled: number; errors: string[] }> = {};

      // ── Helper: push one entity ──────────────────────────────────────────────
      async function pushEntity(
        table: string,
        sheet: string | undefined,
        rows: any[],
        toRagic: (row: any) => Record<string, any>,
      ) {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };
        if (!sheet) return out;
        for (const row of rows) {
          try {
            if (row.ragic_id) {
              // Update existing Ragic record
              await axios.post(ragicUrl(s.ragic_account, sheet, row.ragic_id), toRagic(row), { headers: hdrs });
            } else {
              // Create new Ragic record
              const resp = await axios.post(ragicUrl(s.ragic_account, sheet), toRagic(row), { headers: hdrs });
              const newId = resp.data?._ragicId ?? resp.data?.id ?? Object.keys(resp.data ?? {})[0];
              if (newId) {
                await supabaseAdmin.from(table).update({ ragic_id: String(newId) }).eq('id', row.id).eq('tenant_id', tenantId);
              }
            }
            out.pushed++;
          } catch (err: any) {
            out.errors.push(`Push ${row.id}: ${err.response?.data?.status ?? err.message}`);
          }
        }
        return out;
      }

      // ── Helper: pull one entity ──────────────────────────────────────────────
      async function pullEntity(
        table: string,
        sheet: string | undefined,
        fromRagic: (rec: any) => Record<string, any>,
        uniqueKey: string,
      ) {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };
        if (!sheet) return out;
        try {
          const resp = await axios.get(ragicUrl(s.ragic_account, sheet), { headers: hdrs });
          const records: any[] = Object.entries(resp.data ?? {})
            .filter(([k]) => !isNaN(Number(k)))
            .map(([id, val]: any) => ({ _ragicId: id, ...val }));

          for (const rec of records) {
            try {
              const mapped = fromRagic(rec);
              const { data: existing } = await supabaseAdmin
                .from(table).select('id').eq('ragic_id', rec._ragicId).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from(table).update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from(table).insert({ ...mapped, ragic_id: rec._ragicId, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) {
              out.errors.push(`Pull ${rec._ragicId}: ${err.message}`);
            }
          }
        } catch (err: any) {
          out.errors.push(`Fetch échoué: ${err.response?.data?.status ?? err.message}`);
        }
        return out;
      }

      // ── Contacts ─────────────────────────────────────────────────────────────
      if (s.ragic_sheet_contacts) {
        const { data: contacts } = await supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId);
        const toRagic = (c: any) => ({
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          email: c.email ?? c.email_work ?? '',
          phone: c.phone ?? c.phone_mobile ?? c.phone_work ?? '',
          company_name: c.company_name ?? '',
          address: c.address ?? c.address_work_street ?? '',
          city: c.city ?? c.address_work_city ?? '',
          zip: c.zip ?? c.address_work_zip ?? '',
          country: c.country ?? c.address_work_country ?? '',
          siret: c.siret ?? '',
          category: c.category ?? '',
          notes: c.notes ?? '',
        });
        const fromRagic = (r: any) => ({
          first_name: r.first_name ?? '',
          last_name: r.last_name ?? '',
          email: r.email ?? '',
          phone: r.phone ?? '',
          company_name: r.company_name ?? '',
          address: r.address ?? '',
          city: r.city ?? '',
          zip: r.zip ?? '',
          country: r.country ?? '',
          siret: r.siret ?? '',
          category: r.category ?? '',
          notes: r.notes ?? '',
          candidatures: '',
          affaires: '',
          logo: '',
          ca_amount: 0,
          electronic_signature: '',
          contact_references: '',
          tags: '',
          created_at: new Date().toISOString(),
          created_by: 'ragic',
        });
        const push = await pushEntity('contacts', s.ragic_sheet_contacts, contacts ?? [], toRagic);
        const pull = await pullEntity('contacts', s.ragic_sheet_contacts, fromRagic, 'email');
        results.contacts = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      // ── Projects ─────────────────────────────────────────────────────────────
      if (s.ragic_sheet_projects) {
        const { data: projects } = await supabaseAdmin.from('projects').select('*').eq('tenant_id', tenantId);
        const toRagic = (p: any) => ({
          name: p.name ?? '',
          client: p.client ?? '',
          status: p.status ?? '',
          budget: p.budget ?? 0,
          start_date: p.start_date ?? '',
          end_date: p.end_date ?? '',
          description: p.description ?? '',
          address: p.address ?? '',
          project_code: p.project_code ?? '',
          surface: p.surface ?? '',
          construction_cost: p.construction_cost ?? '',
        });
        const fromRagic = (r: any) => ({
          name: r.name ?? '',
          client: r.client ?? '',
          status: r.status ?? 'Planning',
          budget: parseFloat(r.budget) || 0,
          start_date: r.start_date ?? null,
          end_date: r.end_date ?? null,
          description: r.description ?? '',
          address: r.address ?? '',
          project_code: r.project_code ?? '',
        });
        const push = await pushEntity('projects', s.ragic_sheet_projects, projects ?? [], toRagic);
        const pull = await pullEntity('projects', s.ragic_sheet_projects, fromRagic, 'name');
        results.projects = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      // ── Invoices ──────────────────────────────────────────────────────────────
      if (s.ragic_sheet_invoices) {
        const { data: invoices } = await supabaseAdmin.from('invoices').select('*').eq('tenant_id', tenantId);
        const toRagic = (inv: any) => ({
          invoice_number: inv.invoice_number ?? '',
          project_name: inv.project_name ?? '',
          amount: inv.amount ?? 0,
          tax_amount: inv.tax_amount ?? 0,
          total_amount: inv.total_amount ?? 0,
          status: inv.status ?? '',
          issue_date: inv.issue_date ?? '',
          due_date: inv.due_date ?? '',
          description: inv.description ?? '',
        });
        const fromRagic = (r: any) => ({
          invoice_number: r.invoice_number ?? '',
          amount: parseFloat(r.amount) || 0,
          tax_amount: parseFloat(r.tax_amount) || 0,
          total_amount: parseFloat(r.total_amount) || 0,
          status: r.status ?? 'Draft',
          issue_date: r.issue_date ?? null,
          due_date: r.due_date ?? null,
          description: r.description ?? '',
          project_id: '',
          created_at: new Date().toISOString(),
        });
        const push = await pushEntity('invoices', s.ragic_sheet_invoices, invoices ?? [], toRagic);
        const pull = await pullEntity('invoices', s.ragic_sheet_invoices, fromRagic, 'invoice_number');
        results.invoices = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      // ── Proposals ─────────────────────────────────────────────────────────────
      if (s.ragic_sheet_proposals) {
        const { data: proposals } = await supabaseAdmin.from('proposals').select('*').eq('tenant_id', tenantId);
        const toRagic = (p: any) => ({
          title: p.title ?? '',
          client_name: p.client_name ?? '',
          amount: p.amount ?? 0,
          status: p.status ?? '',
          description: p.description ?? '',
          created_at: p.created_at ?? '',
          construction_cost: p.construction_cost ?? '',
        });
        const fromRagic = (r: any) => ({
          title: r.title ?? '',
          client_id: '',
          client_name: r.client_name ?? '',
          amount: parseFloat(r.amount) || 0,
          status: r.status ?? 'Draft',
          description: r.description ?? '',
          created_at: r.created_at ?? new Date().toISOString(),
        });
        const push = await pushEntity('proposals', s.ragic_sheet_proposals, proposals ?? [], toRagic);
        const pull = await pullEntity('proposals', s.ragic_sheet_proposals, fromRagic, 'title');
        results.proposals = { pushed: push.pushed, pulled: pull.pulled, errors: [...push.errors, ...pull.errors] };
      }

      res.json({ results });
    } catch (error: any) {
      console.error('[Ragic sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync Ragic échouée' });
    }
  });

  // POST /api/ragic/webhook  — receives Ragic webhook notifications
  app.post('/api/ragic/webhook', async (req: any, res: any) => {
    try {
      // Ragic sends the updated record as JSON; detect entity from query param ?entity=contacts|projects|invoices|proposals
      const entity = req.query.entity as string;
      const secret = req.query.secret as string;
      const body = req.body;

      if (!entity || !['contacts', 'projects', 'invoices', 'proposals'].includes(entity)) {
        return res.status(400).json({ error: 'Paramètre entity manquant ou invalide' });
      }

      // Find the tenant by webhook secret (stored in ragic_account field prefix or a dedicated secret)
      const tenantId = req.query.tenant as string;
      if (!tenantId) return res.status(400).json({ error: 'Paramètre tenant manquant' });

      // Validate secret against the tenant's API key prefix
      const { data: settings } = await supabaseAdmin.from('settings')
        .select('ragic_api_key,ragic_sheet_contacts,ragic_sheet_projects,ragic_sheet_invoices,ragic_sheet_proposals')
        .eq('tenant_id', tenantId).single();
      if (!(settings as any)?.ragic_api_key) return res.status(403).json({ error: 'Tenant non configuré' });
      if (secret && secret !== (settings as any).ragic_api_key) return res.status(403).json({ error: 'Secret invalide' });

      const records: any[] = Array.isArray(body) ? body : [body];
      let upserted = 0;

      for (const rec of records) {
        try {
          const ragicId = String(rec._ragicId ?? rec.id ?? '');
          if (!ragicId) continue;

          if (entity === 'contacts') {
            const mapped = {
              first_name: rec.first_name ?? '', last_name: rec.last_name ?? '',
              email: rec.email ?? '', phone: rec.phone ?? '',
              company_name: rec.company_name ?? '', siret: rec.siret ?? '',
              address: rec.address ?? '', city: rec.city ?? '',
              zip: rec.zip ?? '', country: rec.country ?? '',
              notes: rec.notes ?? '', category: rec.category ?? '',
              candidatures: '', affaires: '', logo: '', ca_amount: 0,
              electronic_signature: '', contact_references: '', tags: '', created_by: 'ragic',
            };
            const { data: existing } = await supabaseAdmin.from('contacts').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('contacts').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('contacts').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId, created_at: new Date().toISOString() });
            }
          } else if (entity === 'projects') {
            const mapped = {
              name: rec.name ?? '', client: rec.client ?? '',
              status: rec.status ?? 'Planning', budget: parseFloat(rec.budget) || 0,
              start_date: rec.start_date ?? null, end_date: rec.end_date ?? null,
              description: rec.description ?? '', address: rec.address ?? '',
              project_code: rec.project_code ?? '',
            };
            const { data: existing } = await supabaseAdmin.from('projects').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('projects').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('projects').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId });
            }
          } else if (entity === 'invoices') {
            const mapped = {
              invoice_number: rec.invoice_number ?? '',
              amount: parseFloat(rec.amount) || 0, tax_amount: parseFloat(rec.tax_amount) || 0,
              total_amount: parseFloat(rec.total_amount) || 0,
              status: rec.status ?? 'Draft',
              issue_date: rec.issue_date ?? null, due_date: rec.due_date ?? null,
              description: rec.description ?? '', project_id: '',
            };
            const { data: existing } = await supabaseAdmin.from('invoices').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('invoices').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('invoices').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId, created_at: new Date().toISOString() });
            }
          } else if (entity === 'proposals') {
            const mapped = {
              title: rec.title ?? '', client_id: '',
              client_name: rec.client_name ?? '',
              amount: parseFloat(rec.amount) || 0,
              status: rec.status ?? 'Draft',
              description: rec.description ?? '',
            };
            const { data: existing } = await supabaseAdmin.from('proposals').select('id').eq('ragic_id', ragicId).eq('tenant_id', tenantId).maybeSingle();
            if (existing) {
              await supabaseAdmin.from('proposals').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
            } else {
              await supabaseAdmin.from('proposals').insert({ ...mapped, ragic_id: ragicId, tenant_id: tenantId, created_at: new Date().toISOString() });
            }
          }
          upserted++;
        } catch (err: any) {
          console.error('[Ragic webhook record error]', err.message);
        }
      }

      res.json({ upserted });
    } catch (error: any) {
      console.error('[Ragic webhook error]', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── End Ragic Integration ─────────────────────────────────────────────────

  // ─── Odoo Integration ──────────────────────────────────────────────────────

  // Calls Odoo JSON-RPC endpoint with API key authentication (Odoo 14+)
  async function odooRpc(url: string, db: string, username: string, apiKey: string, model: string, method: string, args: any[], kwargs: any = {}) {
    const resp = await axios.post(
      `${url}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: { model, method, args, kwargs },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
        },
        params: { db },
      }
    );
    if (resp.data?.error) throw new Error(resp.data.error.data?.message ?? resp.data.error.message ?? 'Odoo RPC error');
    return resp.data?.result;
  }

  // GET /api/odoo/status
  app.get('/api/odoo/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('odoo_url,odoo_api_key').eq('tenant_id', tenantId).single();
      const connected = !!(settings as any)?.odoo_url && !!(settings as any)?.odoo_api_key;
      res.json({ connected });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/odoo/disconnect
  app.delete('/api/odoo/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({
        odoo_url: null, odoo_db: null, odoo_username: null, odoo_api_key: null,
      }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion d\'Odoo', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/odoo/sync  — bidirectional sync for contacts, projects, invoices, proposals
  app.post('/api/odoo/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const s = settings as any;
      if (!s?.odoo_url || !s?.odoo_api_key || !s?.odoo_username || !s?.odoo_db) {
        return res.status(400).json({ error: 'Odoo non configuré. Veuillez renseigner l\'URL, la base de données, l\'identifiant et la clé API dans les Paramètres.' });
      }

      const rpc = (model: string, method: string, args: any[], kwargs?: any) =>
        odooRpc(s.odoo_url, s.odoo_db, s.odoo_username, s.odoo_api_key, model, method, args, kwargs);

      const results: Record<string, { pushed: number; pulled: number; errors: string[] }> = {};

      // ── Contacts ─────────────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        // Push: ArchiOffice → Odoo res.partner
        const { data: contacts } = await supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId);
        for (const c of (contacts ?? [])) {
          try {
            const vals = {
              name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Contact',
              email: c.email ?? c.email_work ?? '',
              phone: c.phone ?? c.phone_mobile ?? c.phone_work ?? '',
              street: c.address ?? c.address_work_street ?? '',
              city: c.city ?? c.address_work_city ?? '',
              zip: c.zip ?? c.address_work_zip ?? '',
              vat: c.vat_number ?? '',
              ref: c.siret ?? '',
              comment: c.notes ?? '',
              customer_rank: 1,
              is_company: !!(c.company_name && !c.first_name),
              company_name: c.company_name ?? '',
            };
            if (c.odoo_id) {
              await rpc('res.partner', 'write', [[c.odoo_id], vals]);
            } else {
              const newId = await rpc('res.partner', 'create', [vals]);
              if (newId) await supabaseAdmin.from('contacts').update({ odoo_id: newId }).eq('id', c.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) { out.errors.push(`Push contact ${c.id}: ${err.message}`); }
        }

        // Pull: Odoo res.partner → ArchiOffice
        try {
          const partners = await rpc('res.partner', 'search_read',
            [[['customer_rank', '>', 0]]],
            { fields: ['id', 'name', 'email', 'phone', 'street', 'city', 'zip', 'vat', 'ref', 'comment', 'is_company', 'company_name'], limit: 500 }
          );
          for (const p of (partners ?? [])) {
            try {
              const nameParts = (p.name ?? '').split(' ');
              const mapped = {
                first_name: nameParts[0] ?? '',
                last_name: nameParts.slice(1).join(' ') ?? '',
                email: p.email ?? '',
                phone: p.phone ?? '',
                address: p.street ?? '',
                city: p.city ?? '',
                zip: p.zip ?? '',
                vat_number: p.vat ?? '',
                siret: p.ref ?? '',
                notes: p.comment ?? '',
                company_name: p.company_name ?? '',
                candidatures: '', affaires: '', logo: '', ca_amount: 0,
                electronic_signature: '', contact_references: '', tags: '', created_by: 'odoo',
              };
              const { data: existing } = await supabaseAdmin.from('contacts').select('id').eq('odoo_id', p.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('contacts').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('contacts').insert({ ...mapped, odoo_id: p.id, tenant_id: tenantId, created_at: new Date().toISOString() });
              }
              out.pulled++;
            } catch (err: any) { out.errors.push(`Pull partner ${p.id}: ${err.message}`); }
          }
        } catch (err: any) { out.errors.push(`Pull contacts échoué: ${err.message}`); }

        results.contacts = out;
      } catch (err: any) { results.contacts = { pushed: 0, pulled: 0, errors: [err.message] }; }

      // ── Projects ─────────────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        const { data: projects } = await supabaseAdmin.from('projects').select('*').eq('tenant_id', tenantId);
        for (const p of (projects ?? [])) {
          try {
            const vals = {
              name: p.name ?? '',
              description: p.description ?? '',
              date_start: p.start_date ? p.start_date.split('T')[0] : false,
              date: p.end_date ? p.end_date.split('T')[0] : false,
            };
            if (p.odoo_id) {
              await rpc('project.project', 'write', [[p.odoo_id], vals]);
            } else {
              const newId = await rpc('project.project', 'create', [vals]);
              if (newId) await supabaseAdmin.from('projects').update({ odoo_id: newId }).eq('id', p.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) { out.errors.push(`Push project ${p.id}: ${err.message}`); }
        }

        // Pull
        try {
          const odooProjects = await rpc('project.project', 'search_read',
            [[]],
            { fields: ['id', 'name', 'description', 'date_start', 'date'], limit: 200 }
          );
          for (const op of (odooProjects ?? [])) {
            try {
              const mapped = {
                name: op.name ?? '',
                description: op.description ?? '',
                start_date: op.date_start ?? null,
                end_date: op.date ?? null,
                status: 'Planning' as const,
                budget: 0,
                client: '',
              };
              const { data: existing } = await supabaseAdmin.from('projects').select('id').eq('odoo_id', op.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('projects').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('projects').insert({ ...mapped, odoo_id: op.id, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) { out.errors.push(`Pull project ${op.id}: ${err.message}`); }
          }
        } catch (err: any) { out.errors.push(`Pull projects échoué: ${err.message}`); }

        results.projects = out;
      } catch (err: any) { results.projects = { pushed: 0, pulled: 0, errors: [err.message] }; }

      // ── Invoices ─────────────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        const { data: invoices } = await supabaseAdmin.from('invoices').select('*').eq('tenant_id', tenantId);
        for (const inv of (invoices ?? [])) {
          try {
            const vals = {
              move_type: 'out_invoice',
              name: inv.invoice_number ?? '/',
              ref: inv.description ?? '',
              invoice_date: inv.issue_date ? inv.issue_date.split('T')[0] : false,
              invoice_date_due: inv.due_date ? inv.due_date.split('T')[0] : false,
              invoice_line_ids: (inv.items && (inv as any).items.length)
                ? (inv as any).items.map((item: any) => ([0, 0, {
                    name: item.description ?? 'Prestation',
                    quantity: item.quantity ?? 1,
                    price_unit: item.unit_price ?? item.amount ?? 0,
                    tax_ids: [],
                  }]))
                : [[0, 0, { name: inv.description ?? 'Honoraires', quantity: 1, price_unit: inv.amount ?? 0, tax_ids: [] }]],
            };
            if (inv.odoo_id) {
              await rpc('account.move', 'write', [[inv.odoo_id], { ref: vals.ref, invoice_date_due: vals.invoice_date_due }]);
            } else {
              const newId = await rpc('account.move', 'create', [vals]);
              if (newId) await supabaseAdmin.from('invoices').update({ odoo_id: newId }).eq('id', inv.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) { out.errors.push(`Push invoice ${inv.id}: ${err.message}`); }
        }

        // Pull
        try {
          const odooInvoices = await rpc('account.move', 'search_read',
            [[['move_type', '=', 'out_invoice']]],
            { fields: ['id', 'name', 'amount_untaxed', 'amount_tax', 'amount_total', 'payment_state', 'invoice_date', 'invoice_date_due', 'ref'], limit: 500 }
          );
          const stateMap: Record<string, string> = { paid: 'Paid', not_paid: 'Sent', in_payment: 'Sent', partial: 'Sent', reversed: 'Draft' };
          for (const oi of (odooInvoices ?? [])) {
            try {
              const mapped = {
                invoice_number: oi.name ?? '',
                amount: oi.amount_untaxed ?? 0,
                tax_amount: oi.amount_tax ?? 0,
                total_amount: oi.amount_total ?? 0,
                status: stateMap[oi.payment_state] ?? 'Draft',
                issue_date: oi.invoice_date ?? null,
                due_date: oi.invoice_date_due ?? null,
                description: oi.ref ?? '',
                project_id: '',
                created_at: new Date().toISOString(),
              };
              const { data: existing } = await supabaseAdmin.from('invoices').select('id').eq('odoo_id', oi.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('invoices').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('invoices').insert({ ...mapped, odoo_id: oi.id, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) { out.errors.push(`Pull invoice ${oi.id}: ${err.message}`); }
          }
        } catch (err: any) { out.errors.push(`Pull invoices échoué: ${err.message}`); }

        results.invoices = out;
      } catch (err: any) { results.invoices = { pushed: 0, pulled: 0, errors: [err.message] }; }

      // ── Proposals / Devis ─────────────────────────────────────────────────────
      try {
        const out = { pushed: 0, pulled: 0, errors: [] as string[] };

        const { data: proposals } = await supabaseAdmin.from('proposals').select('*').eq('tenant_id', tenantId);
        for (const prop of (proposals ?? [])) {
          try {
            const vals = {
              name: prop.title ?? 'Devis',
              note: prop.description ?? '',
              client_order_ref: prop.project_code ?? '',
            };
            if (prop.odoo_id) {
              await rpc('sale.order', 'write', [[prop.odoo_id], vals]);
            } else {
              const newId = await rpc('sale.order', 'create', [vals]);
              if (newId) await supabaseAdmin.from('proposals').update({ odoo_id: newId }).eq('id', prop.id).eq('tenant_id', tenantId);
            }
            out.pushed++;
          } catch (err: any) { out.errors.push(`Push proposal ${prop.id}: ${err.message}`); }
        }

        // Pull
        try {
          const odooOrders = await rpc('sale.order', 'search_read',
            [[]],
            { fields: ['id', 'name', 'amount_total', 'state', 'note', 'date_order', 'partner_id'], limit: 200 }
          );
          const saleStateMap: Record<string, string> = { draft: 'Draft', sent: 'Sent', sale: 'Accepted', done: 'Accepted', cancel: 'Rejected' };
          for (const so of (odooOrders ?? [])) {
            try {
              const mapped = {
                title: so.name ?? '',
                client_id: '',
                client_name: so.partner_id?.[1] ?? '',
                amount: so.amount_total ?? 0,
                status: saleStateMap[so.state] ?? 'Draft',
                description: so.note ?? '',
                created_at: so.date_order ?? new Date().toISOString(),
              };
              const { data: existing } = await supabaseAdmin.from('proposals').select('id').eq('odoo_id', so.id).eq('tenant_id', tenantId).maybeSingle();
              if (existing) {
                await supabaseAdmin.from('proposals').update(mapped).eq('id', (existing as any).id).eq('tenant_id', tenantId);
              } else {
                await supabaseAdmin.from('proposals').insert({ ...mapped, odoo_id: so.id, tenant_id: tenantId });
              }
              out.pulled++;
            } catch (err: any) { out.errors.push(`Pull sale.order ${so.id}: ${err.message}`); }
          }
        } catch (err: any) { out.errors.push(`Pull proposals échoué: ${err.message}`); }

        results.proposals = out;
      } catch (err: any) { results.proposals = { pushed: 0, pulled: 0, errors: [err.message] }; }

      const totalPushed = Object.values(results).reduce((sum, r) => sum + (r?.pushed || 0), 0);
      const totalPulled = Object.values(results).reduce((sum, r) => sum + (r?.pulled || 0), 0);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Odoo (${totalPushed} envoyée(s), ${totalPulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ results });
    } catch (error: any) {
      console.error('[Odoo sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync Odoo échouée' });
    }
  });

  // POST /api/odoo/test  — test connectivity without syncing
  app.post('/api/odoo/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('odoo_url,odoo_db,odoo_username,odoo_api_key').eq('tenant_id', tenantId).single();
      const s = settings as any;
      if (!s?.odoo_url || !s?.odoo_api_key || !s?.odoo_username || !s?.odoo_db) {
        return res.status(400).json({ error: 'Configuration incomplète' });
      }
      // Simple connectivity test: list Odoo companies
      const result = await odooRpc(s.odoo_url, s.odoo_db, s.odoo_username, s.odoo_api_key, 'res.company', 'search_read', [[]], { fields: ['name'], limit: 1 });
      const company = result?.[0]?.name ?? 'Odoo';
      res.json({ connected: true, company });
    } catch (error: any) {
      res.status(400).json({ connected: false, error: error.message });
    }
  });

  // ─── End Odoo Integration ───────────────────────────────────────────────────

  // ─── SuperPDP Integration ────────────────────────────────────────────────────
  const SUPERPDP_BASE = 'https://api.superpdp.tech';

  async function superpdpToken(clientId: string, clientSecret: string): Promise<string> {
    const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
    const r = await fetch(`${SUPERPDP_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!r.ok) throw new Error(`SuperPDP token error ${r.status}: ${await r.text()}`);
    const json = await r.json() as any;
    return json.access_token as string;
  }

  async function superpdpFetch(token: string, path: string, opts: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(opts.headers as any || {}) };
    const r = await fetch(`${SUPERPDP_BASE}${path}`, { ...opts, headers });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`SuperPDP API error ${r.status}: ${body}`);
    }
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return r.json();
    return r.text();
  }

  function buildEnInvoice(invoice: any, items: any[], settings: any): any {
    const vatRate = invoice.vat_rate ?? 20;
    const amountHT = parseFloat(invoice.amount ?? 0);
    const taxAmount = parseFloat(invoice.tax_amount ?? amountHT * vatRate / 100);
    const totalTTC = parseFloat(invoice.total_amount ?? amountHT + taxAmount);

    const sellerName = invoice.seller_name || settings.agency_name || 'Architecte';
    const sellerAddress = invoice.seller_address || settings.address || '';
    const sellerSiret = invoice.seller_siret || settings.siret || '';
    const sellerVat = invoice.seller_vat_number || settings.vat_number || '';
    const sellerEmail = settings.email || '';

    const lines = items.length > 0 ? items.map((item: any, idx: number) => {
      const qty = parseFloat(item.quantity ?? 1);
      const unitPrice = parseFloat(item.unit_price ?? 0);
      const netAmount = qty * unitPrice;
      return {
        identifier: String(idx + 1),
        invoiced_quantity: String(qty),
        invoiced_quantity_code: 'C62',
        net_amount: netAmount.toFixed(2),
        item_information: { name: item.description || 'Prestation' },
        price_details: { item_net_price: unitPrice.toFixed(2) },
        vat_information: { vat_category_code: 'S', vat_category_rate: String(vatRate) },
      };
    }) : [{
      identifier: '1',
      invoiced_quantity: '1',
      invoiced_quantity_code: 'C62',
      net_amount: amountHT.toFixed(2),
      item_information: { name: invoice.description || 'Honoraires d\'architecture' },
      price_details: { item_net_price: amountHT.toFixed(2) },
      vat_information: { vat_category_code: 'S', vat_category_rate: String(vatRate) },
    }];

    return {
      number: invoice.invoice_number || invoice.id,
      issue_date: invoice.issue_date || new Date().toISOString().slice(0, 10),
      type_code: '380',
      currency_code: 'EUR',
      process_control: { specification_identifier: 'urn:cen.eu:en16931:2017' },
      payment_due_date: invoice.due_date || undefined,
      seller: {
        name: sellerName,
        electronic_address: { value: sellerEmail || 'contact@cabinet.fr', scheme: 'EM' },
        postal_address: { address_line1: sellerAddress, country_code: 'FR' },
        ...(sellerVat ? { vat_identifier: sellerVat } : {}),
        ...(sellerSiret ? { legal_registration_identifier: { value: sellerSiret, scheme: '0002' } } : {}),
      },
      buyer: {
        name: invoice.client_name || invoice.mission_name || 'Client',
        postal_address: { country_code: 'FR' },
      },
      totals: {
        sum_invoice_lines_amount: amountHT.toFixed(2),
        total_without_vat: amountHT.toFixed(2),
        total_vat_amount: { value: taxAmount.toFixed(2) },
        total_with_vat: totalTTC.toFixed(2),
        amount_due_for_payment: totalTTC.toFixed(2),
      },
      vat_break_down: [{
        vat_category_code: 'S',
        vat_category_rate: String(vatRate),
        vat_category_taxable_amount: amountHT.toFixed(2),
        vat_category_tax_amount: taxAmount.toFixed(2),
      }],
      lines,
    };
  }

  // GET /api/superpdp/status
  app.get('/api/superpdp/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret,superpdp_sandbox').eq('tenant_id', tenantId).single();
      const connected = !!(s as any)?.superpdp_client_id && !!(s as any)?.superpdp_client_secret;
      res.json({ connected, sandbox: (s as any)?.superpdp_sandbox ?? true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/superpdp/disconnect
  app.delete('/api/superpdp/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({ superpdp_client_id: null, superpdp_client_secret: null }).eq('tenant_id', tenantId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/superpdp/test — verify credentials by fetching company info
  app.post('/api/superpdp/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Configuration incomplète' });
      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const company = await superpdpFetch(token, '/v1.beta/companies/me');
      res.json({ connected: true, company: company?.formal_name || company?.name || 'SuperPDP' });
    } catch (e: any) { res.status(400).json({ connected: false, error: e.message }); }
  });

  // POST /api/superpdp/send/:invoiceId — send one invoice to SuperPDP
  app.post('/api/superpdp/send/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;

      const [settingsRes, invoiceRes, itemsRes] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId),
      ]);
      const cfg = settingsRes.data as any;
      const invoice = invoiceRes.data as any;
      const items = itemsRes.data || [];

      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'SuperPDP non configuré' });
      if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const enInvoice = buildEnInvoice(invoice, items, cfg);

      // Convert en16931 JSON → CII XML
      const ciiXml = await superpdpFetch(token, '/v1.beta/invoices/convert?from=en16931&to=cii', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/xml' },
        body: JSON.stringify(enInvoice),
      });

      // Send CII XML to SuperPDP
      const externalId = invoiceId.slice(0, 36);
      const sent = await superpdpFetch(token, `/v1.beta/invoices?external_id=${encodeURIComponent(externalId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: typeof ciiXml === 'string' ? ciiXml : JSON.stringify(ciiXml),
      });

      const superpdpId = sent?.id;
      const superpdpStatus = sent?.events?.[sent.events.length - 1]?.status_code || 'api:uploaded';
      await supabaseAdmin.from('invoices').update({ superpdp_id: superpdpId, superpdp_status: superpdpStatus }).eq('id', invoiceId);

      res.json({ success: true, superpdp_id: superpdpId, status: superpdpStatus });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/superpdp/events/:invoiceId — get lifecycle events for an invoice
  app.get('/api/superpdp/events/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'SuperPDP non configuré' });

      const { data: inv } = await supabaseAdmin.from('invoices').select('superpdp_id,superpdp_status').eq('id', invoiceId).eq('tenant_id', tenantId).single();
      const superpdpId = (inv as any)?.superpdp_id;
      if (!superpdpId) return res.status(404).json({ error: 'Facture non envoyée via SuperPDP' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const events = await superpdpFetch(token, `/v1.beta/invoice_events?invoice_id=${superpdpId}`);

      // Update local status with latest event
      const latest = events?.data?.[events.data.length - 1]?.status_code;
      if (latest) await supabaseAdmin.from('invoices').update({ superpdp_status: latest }).eq('id', invoiceId);

      res.json({ events: events?.data || [], latest_status: latest });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/superpdp/invoices — list all invoices from SuperPDP
  app.get('/api/superpdp/invoices', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'SuperPDP non configuré' });
      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const result = await superpdpFetch(token, '/v1.beta/invoices?direction=out&limit=100');
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Situations / factures de travaux — marchés privés ──────────────────────
  // Chorus Pro is reserved for marchés publics. For private markets, the same
  // workflow (retrouver la facture de l'entreprise, la lier, joindre l'état
  // d'acompte MOE en pièce jointe complémentaire) is offered via Super PDP,
  // the Plateforme Agréée déjà connectée par le cabinet pour ses honoraires.
  async function loadSituationForSuperpdp(tenantId: string, situationId: string) {
    const { data: sit } = await supabaseAdmin
      .from('situations')
      .select('*, marche:marches_entreprises(*)')
      .eq('id', situationId)
      .eq('tenant_id', tenantId)
      .single();
    if (!sit) return null;
    const marche = (sit as any).marche as any;
    const { data: detailsRaw } = await supabaseAdmin
      .from('detail_situations')
      .select('*, dpgf_item:dpgf_items(designation, prix_unitaire_ht, quantite_prevue, unite)')
      .eq('tenant_id', tenantId)
      .eq('situation_id', situationId);
    return { sit, marche, details: detailsRaw ?? [] };
  }

  // POST /api/superpdp/search-situation-facture/:situationId — find the
  // entreprise's facture already deposited on Super PDP for this marché
  app.post('/api/superpdp/search-situation-facture/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { buyer_siret } = req.body || {};

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single(),
        loadSituationForSuperpdp(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Super PDP non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche } = loaded;
      if (!marche?.entreprise_siret) return res.status(400).json({ error: "Le SIRET de l'entreprise (marché lié) est obligatoire pour rechercher sa facture" });
      const finalBuyerSiret = buyer_siret || sit.buyer_siret;
      if (!finalBuyerSiret) return res.status(400).json({ error: 'Le SIRET du destinataire est obligatoire pour la recherche' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const result = await superpdpFetch(token, `/v1.beta/invoices?supplier_siret=${encodeURIComponent(marche.entreprise_siret)}&buyer_siret=${encodeURIComponent(finalBuyerSiret)}&limit=20`);

      const factures = (result?.data || []).map((f: any) => ({
        identifiantFactureCPP: String(f.id),
        numeroFacture: f.en_invoice?.number || null,
        dateFacture: f.en_invoice?.issue_date || null,
        montantTtc: f.en_invoice?.totals?.total_with_vat ? Number(f.en_invoice.totals.total_with_vat) : null,
        statut: f.events?.[f.events.length - 1]?.status_code || null,
      }));

      res.json({ factures });
    } catch (e: any) {
      console.error('[SuperPDP search-situation-facture]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/superpdp/link-situation/:situationId — link this situation to
  // the entreprise's facture found on Super PDP (no new facture is created)
  app.post('/api/superpdp/link-situation/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { superpdp_id, statut, buyer_siret, buyer_service_code, engagement_number } = req.body || {};
      if (!superpdp_id) return res.status(400).json({ error: 'Identifiant de facture Super PDP manquant' });

      const { data: updated, error } = await supabaseAdmin.from('situations').update({
        superpdp_id: Number(superpdp_id),
        superpdp_status: statut || 'api:uploaded',
        buyer_siret: buyer_siret || null,
        buyer_service_code: buyer_service_code || null,
        engagement_number: engagement_number || null,
      }).eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/superpdp/attach-etat-acompte/:situationId — generate the état
  // d'acompte PDF and deposit it as a complementary attachment on the
  // entreprise's facture already linked on Super PDP
  app.post('/api/superpdp/attach-etat-acompte/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('agency_name,superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single(),
        loadSituationForSuperpdp(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Super PDP non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche, details } = loaded;
      if (!sit.superpdp_id) return res.status(400).json({ error: "Recherchez et liez d'abord la facture de l'entreprise avant de joindre l'état d'acompte" });

      const pdfBuf = await buildEtatAcomptePdfBuffer(sit, marche, details, cfg.agency_name || '');
      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      await superpdpFetch(token, `/v1.beta/invoices/${sit.superpdp_id}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `etat-acompte-${sit.numero_situation}.pdf`,
          content_base64: pdfBuf.toString('base64'),
          comment: `État d'acompte MOE n°${sit.numero_situation}${marche ? ` — ${marche.entreprise_nom}, lot ${marche.lot_numero}` : ''}`,
        }),
      });

      const { data: updated, error } = await supabaseAdmin.from('situations')
        .update({ etat_acompte_joint_at: new Date().toISOString() })
        .eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) {
      console.error('[SuperPDP attach-etat-acompte]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/superpdp/situation-status/:situationId — consult/refresh the
  // status of the linked entreprise facture
  app.get('/api/superpdp/situation-status/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings').select('superpdp_client_id,superpdp_client_secret').eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!cfg?.superpdp_client_id || !cfg?.superpdp_client_secret) return res.status(400).json({ error: 'Super PDP non configuré' });

      const { data: sit } = await supabaseAdmin.from('situations').select('superpdp_id,superpdp_status').eq('id', situationId).eq('tenant_id', tenantId).single();
      const superpdpId = (sit as any)?.superpdp_id;
      if (!superpdpId) return res.status(404).json({ error: 'Situation non liée à Super PDP' });

      const token = await superpdpToken(cfg.superpdp_client_id, cfg.superpdp_client_secret);
      const events = await superpdpFetch(token, `/v1.beta/invoice_events?invoice_id=${superpdpId}`);
      const latest = events?.data?.[events.data.length - 1]?.status_code;
      if (latest) await supabaseAdmin.from('situations').update({ superpdp_status: latest }).eq('id', situationId).eq('tenant_id', tenantId);

      res.json({ events: events?.data || [], latest_status: latest || (sit as any)?.superpdp_status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/superpdp/situations — list local situations linked to an entreprise facture on Super PDP
  app.get('/api/superpdp/situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('situations')
        .select('*, marche:marches_entreprises(entreprise_nom,entreprise_siret,lot_numero,lot_titre,tva_rate,revision_active), projects(name)')
        .eq('tenant_id', tenantId)
        .not('superpdp_id', 'is', null)
        .order('date_situation', { ascending: false });
      if (error) throw error;
      const result = await Promise.all((data || []).map(async (s: any) => {
        const { data: details } = await supabaseAdmin.from('detail_situations').select('*').eq('tenant_id', tenantId).eq('situation_id', s.id);
        const net = computeEtatAcompte(s, s.marche, details ?? []);
        const project_name = s.projects?.name || null;
        const { projects: _p, ...rest } = s;
        return { ...rest, project_name, montant_ttc: net.net };
      }));
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── End SuperPDP Integration ────────────────────────────────────────────────

  // ─── Chorus Pro Integration ────────────────────────────────────────────────
  // Chorus Pro is the French government's mandatory B2G e-invoicing platform
  // (facturation à destination des maîtrises d'ouvrage publiques). Access uses
  // PISTE (OAuth2 client_credentials) plus a separate Chorus Pro "compte
  // technique" sent via the cpro-account header (base64 of login:password).
  function chorusProUrls(sandbox: boolean) {
    return sandbox
      ? { oauth: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token', api: 'https://sandbox-api.aife.economie.gouv.fr' }
      : { oauth: 'https://oauth.aife.economie.gouv.fr/api/oauth/token', api: 'https://api.aife.economie.gouv.fr' };
  }

  async function chorusProToken(clientId: string, clientSecret: string, sandbox: boolean): Promise<string> {
    const { oauth } = chorusProUrls(sandbox);
    const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'openid' });
    const r = await fetch(oauth, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (!r.ok) throw new Error(`Chorus Pro (PISTE) — jeton OAuth2 refusé (${r.status}): ${await r.text()}`);
    const json = await r.json() as any;
    return json.access_token as string;
  }

  async function chorusProFetch(cfg: { token: string; login: string; password: string; sandbox: boolean }, path: string, body: any): Promise<any> {
    const { api } = chorusProUrls(cfg.sandbox);
    const cproAccount = Buffer.from(`${cfg.login}:${cfg.password}`).toString('base64');
    const r = await fetch(`${api}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'cpro-account': cproAccount,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!r.ok) throw new Error(`Chorus Pro API — erreur ${r.status}: ${json?.libelle || text}`);
    if (json && typeof json.codeRetour === 'number' && json.codeRetour !== 0) {
      throw new Error(`Chorus Pro API — code retour ${json.codeRetour}: ${json.libelle || 'erreur inconnue'}`);
    }
    return json;
  }

  function buildChorusProSubmission(invoice: any, items: any[], settings: any): any {
    const vatRate = invoice.vat_rate ?? 20;
    const amountHT = parseFloat(invoice.amount ?? 0);
    const taxAmount = parseFloat(invoice.tax_amount ?? amountHT * vatRate / 100);
    const totalTTC = parseFloat(invoice.total_amount ?? amountHT + taxAmount);
    const sellerSiret = invoice.seller_siret || settings.siret || '';

    const lignePosteDtoList = (items.length > 0 ? items : [{ description: invoice.description || "Honoraires d'architecture", quantity: 1, unit_price: amountHT, vat_rate: vatRate }])
      .map((item: any, idx: number) => ({
        numeroLigne: idx + 1,
        denomination: (item.description || 'Prestation').slice(0, 255),
        quantite: parseFloat(item.quantity ?? 1),
        montantUnitaireHT: parseFloat(item.unit_price ?? 0).toFixed(2),
        montantHTApresRemise: (parseFloat(item.quantity ?? 1) * parseFloat(item.unit_price ?? 0)).toFixed(2),
        tauxTva: parseFloat(item.vat_rate ?? vatRate),
      }));

    return {
      modeDepotSoumission: 'SAISIE_API',
      typeFacture: 'FACTURE',
      typeTva: 'TVA_SUR_DEBIT',
      dateFacture: invoice.issue_date || new Date().toISOString().slice(0, 10),
      dateEcheancePaiement: invoice.due_date || undefined,
      numeroFactureSaisie: invoice.invoice_number || invoice.id,
      devise: invoice.currency || 'EUR',
      fournisseur: { siret: sellerSiret },
      destinataire: { siret: invoice.buyer_siret },
      ...(invoice.engagement_number ? { numeroEngagementFacture: invoice.engagement_number } : {}),
      ...(invoice.buyer_service_code ? { codeServiceExecutant: invoice.buyer_service_code } : {}),
      montantHtTotal: amountHT.toFixed(2),
      montantTvaTotal: taxAmount.toFixed(2),
      montantTtcTotal: totalTTC.toFixed(2),
      ligneTvaDtoList: [{ montantBaseHtLigne: amountHT.toFixed(2), montantTvaLigne: taxAmount.toFixed(2), tauxTvaLigne: vatRate }],
      lignePosteDtoList,
    };
  }

  function chorusProCfgComplete(cfg: any): boolean {
    return !!(cfg?.chorus_pro_piste_client_id && cfg?.chorus_pro_piste_client_secret && cfg?.chorus_pro_technical_login && cfg?.chorus_pro_technical_password);
  }

  // GET /api/chorus-pro/status
  app.get('/api/chorus-pro/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings')
        .select('chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      res.json({ connected: chorusProCfgComplete(cfg), sandbox: cfg?.chorus_pro_sandbox ?? true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/chorus-pro/disconnect
  app.delete('/api/chorus-pro/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await supabaseAdmin.from('settings').update({
        chorus_pro_piste_client_id: null, chorus_pro_piste_client_secret: null,
        chorus_pro_technical_login: null, chorus_pro_technical_password: null,
      }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Chorus Pro', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/chorus-pro/test — verify both credential layers: the PISTE OAuth2
  // client (token request) AND the Chorus Pro compte technique (cpro-account
  // header), by looking up the tenant's own SIRET in the structures directory.
  app.post('/api/chorus-pro/test', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: s } = await supabaseAdmin.from('settings')
        .select('siret,chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ connected: false, error: 'Configuration incomplète' });
      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      if (cfg.siret) {
        await chorusProFetch(
          { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
          '/cpro/structures/v1/rechercher/siret',
          { siret: cfg.siret },
        );
      }
      res.json({ connected: true, sandbox });
    } catch (e: any) { res.status(400).json({ connected: false, error: e.message }); }
  });

  // POST /api/chorus-pro/send/:invoiceId — submit one invoice to Chorus Pro
  app.post('/api/chorus-pro/send/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;
      const { buyer_siret, buyer_service_code, engagement_number } = req.body || {};

      const [settingsRes, invoiceRes, itemsRes] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', invoiceId).eq('tenant_id', tenantId),
      ]);
      const cfg = settingsRes.data as any;
      let invoice = invoiceRes.data as any;
      const items = itemsRes.data || [];

      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });
      if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });

      // Fall back to the SIRET already captured on the linked project (Factur-X fields)
      // so it doesn't need to be re-entered when it's already known there.
      let projectSiret: string | null = null;
      if (!buyer_siret && !invoice.buyer_siret && invoice.project_id) {
        const { data: project } = await supabaseAdmin.from('projects').select('client_siret').eq('id', invoice.project_id).eq('tenant_id', tenantId).single();
        projectSiret = (project as any)?.client_siret || null;
      }

      const finalBuyerSiret = buyer_siret || invoice.buyer_siret || projectSiret;
      if (!finalBuyerSiret) return res.status(400).json({ error: 'Le SIRET du destinataire (structure publique) est obligatoire' });

      // Persist the B2G fields for reuse on the next submission of this invoice
      const { data: updated, error: updateErr } = await supabaseAdmin.from('invoices').update({
        buyer_siret: finalBuyerSiret,
        buyer_service_code: buyer_service_code ?? invoice.buyer_service_code ?? null,
        engagement_number: engagement_number ?? invoice.engagement_number ?? null,
      }).eq('id', invoiceId).eq('tenant_id', tenantId).select('*').single();
      if (updateErr) throw updateErr;
      invoice = updated;

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const payload = buildChorusProSubmission(invoice, items, cfg);

      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/soumettre',
        payload,
      );

      const chorusProId = result?.identifiantFactureCPP ? String(result.identifiantFactureCPP) : (result?.numeroFluxDepot ? String(result.numeroFluxDepot) : null);
      const chorusProStatus = 'DEPOSEE';
      await supabaseAdmin.from('invoices').update({ chorus_pro_id: chorusProId, chorus_pro_status: chorusProStatus }).eq('id', invoiceId).eq('tenant_id', tenantId);

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Envoi de la facture N° ${invoice.invoice_number || invoiceId.slice(0, 8)} sur Chorus Pro`, '', invoiceId, 'integration', 'Intégrations');
      res.json({ success: true, chorus_pro_id: chorusProId, status: chorusProStatus });
    } catch (e: any) {
      console.error('[Chorus Pro send]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/chorus-pro/status/:invoiceId — consult/refresh the status of a submitted invoice
  app.get('/api/chorus-pro/status/:invoiceId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { invoiceId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings')
        .select('chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });

      const { data: inv } = await supabaseAdmin.from('invoices').select('chorus_pro_id,chorus_pro_status').eq('id', invoiceId).eq('tenant_id', tenantId).single();
      const chorusProId = (inv as any)?.chorus_pro_id;
      if (!chorusProId) return res.status(404).json({ error: "Facture non envoyée à Chorus Pro" });

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/consulter/historique_statut',
        { identifiantFactureCPP: chorusProId },
      );

      const historique = result?.listeHistoriqueStatutVo || result?.listeStatuts || [];
      const latest = historique.length > 0 ? (historique[historique.length - 1]?.statut || historique[historique.length - 1]?.libelleStatut) : null;
      if (latest) await supabaseAdmin.from('invoices').update({ chorus_pro_status: latest }).eq('id', invoiceId).eq('tenant_id', tenantId);

      res.json({ history: historique, latest_status: latest || (inv as any)?.chorus_pro_status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/chorus-pro/invoices — list local invoices already submitted to Chorus Pro
  app.get('/api/chorus-pro/invoices', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('invoices')
        .select('*, projects(name)')
        .eq('tenant_id', tenantId)
        .not('chorus_pro_id', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = (data || []).map((inv: any) => {
        const project_name = inv.projects?.name || null;
        const { projects: _p, ...rest } = inv;
        return { ...rest, project_name };
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Situations / factures de travaux ────────────────────────────────────────
  // As MOE (maîtrise d'œuvre), ArchiOffice never submits a new facture for a
  // situation de travaux — the entreprise already deposited its own facture on
  // Chorus Pro under its own compte. Per Chorus Pro's official guidance for
  // MOE ("Gérer les factures de travaux sur Chorus Pro pour les MOE"), the
  // MOE's job is to (1) retrieve that facture, (2) accept/rectify the décompte
  // mensuel (already computed by this module), and (3) attach its état
  // d'acompte to the facture as a pièce jointe complémentaire, with its visa.
  async function loadSituationForChorusPro(tenantId: string, situationId: string) {
    const { data: sit } = await supabaseAdmin
      .from('situations')
      .select('*, marche:marches_entreprises(*)')
      .eq('id', situationId)
      .eq('tenant_id', tenantId)
      .single();
    if (!sit) return null;
    const marche = (sit as any).marche as any;
    const { data: detailsRaw } = await supabaseAdmin
      .from('detail_situations')
      .select('*, dpgf_item:dpgf_items(designation, prix_unitaire_ht, quantite_prevue, unite)')
      .eq('tenant_id', tenantId)
      .eq('situation_id', situationId);
    return { sit, marche, details: detailsRaw ?? [] };
  }

  // POST /api/chorus-pro/search-situation-facture/:situationId — find the
  // entreprise's facture already deposited on Chorus Pro for this marché
  app.post('/api/chorus-pro/search-situation-facture/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { buyer_siret } = req.body || {};

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        loadSituationForChorusPro(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche } = loaded;
      if (!marche?.entreprise_siret) return res.status(400).json({ error: "Le SIRET de l'entreprise (marché lié) est obligatoire pour rechercher sa facture" });
      const finalBuyerSiret = buyer_siret || sit.buyer_siret;
      if (!finalBuyerSiret) return res.status(400).json({ error: 'Le SIRET du destinataire (structure publique) est obligatoire pour la recherche' });

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/rechercher/recipiendaire',
        { siretRecipiendaire: finalBuyerSiret, critereRecherche: { siretFournisseur: marche.entreprise_siret } },
      );

      const factures = (result?.listeFactures || result?.factures || []).map((f: any) => ({
        identifiantFactureCPP: f.identifiantFactureCPP ? String(f.identifiantFactureCPP) : String(f.id ?? ''),
        numeroFacture: f.numeroFactureSaisie || f.numeroFacture || null,
        dateFacture: f.dateFacture || f.dateDepot || null,
        montantTtc: f.montantTtcTotal ?? f.montantTTC ?? null,
        statut: f.statut || f.libelleStatut || null,
      }));

      res.json({ factures });
    } catch (e: any) {
      console.error('[Chorus Pro search-situation-facture]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/chorus-pro/link-situation/:situationId — link this situation to
  // the entreprise's facture found on Chorus Pro (no new facture is created)
  app.post('/api/chorus-pro/link-situation/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { chorus_pro_id, buyer_siret, buyer_service_code, engagement_number, statut } = req.body || {};
      if (!chorus_pro_id) return res.status(400).json({ error: 'Identifiant de facture Chorus Pro manquant' });

      const { data: updated, error } = await supabaseAdmin.from('situations').update({
        chorus_pro_id: String(chorus_pro_id),
        chorus_pro_status: statut || 'LIEE',
        buyer_siret: buyer_siret || null,
        buyer_service_code: buyer_service_code || null,
        engagement_number: engagement_number || null,
      }).eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/chorus-pro/attach-etat-acompte/:situationId — generate the état
  // d'acompte PDF and deposit it as a pièce jointe complémentaire on the
  // entreprise's facture already linked on Chorus Pro
  app.post('/api/chorus-pro/attach-etat-acompte/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;

      const [settingsRes, loaded] = await Promise.all([
        supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single(),
        loadSituationForChorusPro(tenantId, situationId),
      ]);
      const cfg = settingsRes.data as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });
      if (!loaded) return res.status(404).json({ error: 'Situation introuvable' });
      const { sit, marche, details } = loaded;
      if (!sit.chorus_pro_id) return res.status(400).json({ error: "Recherchez et liez d'abord la facture de l'entreprise avant de joindre l'état d'acompte" });

      const pdfBuf = await buildEtatAcomptePdfBuffer(sit, marche, details, cfg.agency_name || '');
      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/pieceJointeComplementaire/v1/deposer',
        {
          identifiantFactureCPP: sit.chorus_pro_id,
          nomPieceJointe: `etat-acompte-${sit.numero_situation}.pdf`.slice(0, 50),
          contenuPieceJointe: pdfBuf.toString('base64'),
          commentaire: `État d'acompte MOE n°${sit.numero_situation}${marche ? ` — ${marche.entreprise_nom}, lot ${marche.lot_numero}` : ''}`,
        },
      );

      const { data: updated, error } = await supabaseAdmin.from('situations')
        .update({ etat_acompte_joint_at: new Date().toISOString() })
        .eq('id', situationId).eq('tenant_id', tenantId).select('*').single();
      if (error) throw error;

      res.json({ success: true, situation: updated });
    } catch (e: any) {
      console.error('[Chorus Pro attach-etat-acompte]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/chorus-pro/situation-status/:situationId — consult/refresh the
  // status of the linked entreprise facture (not a facture we deposited)
  app.get('/api/chorus-pro/situation-status/:situationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { situationId } = req.params;
      const { data: s } = await supabaseAdmin.from('settings')
        .select('chorus_pro_piste_client_id,chorus_pro_piste_client_secret,chorus_pro_technical_login,chorus_pro_technical_password,chorus_pro_sandbox')
        .eq('tenant_id', tenantId).single();
      const cfg = s as any;
      if (!chorusProCfgComplete(cfg)) return res.status(400).json({ error: 'Chorus Pro non configuré' });

      const { data: sit } = await supabaseAdmin.from('situations').select('chorus_pro_id,chorus_pro_status').eq('id', situationId).eq('tenant_id', tenantId).single();
      const chorusProId = (sit as any)?.chorus_pro_id;
      if (!chorusProId) return res.status(404).json({ error: 'Situation non envoyée à Chorus Pro' });

      const sandbox = cfg.chorus_pro_sandbox ?? true;
      const token = await chorusProToken(cfg.chorus_pro_piste_client_id, cfg.chorus_pro_piste_client_secret, sandbox);
      const result = await chorusProFetch(
        { token, login: cfg.chorus_pro_technical_login, password: cfg.chorus_pro_technical_password, sandbox },
        '/cpro/factures/v1/consulter/historique_statut',
        { identifiantFactureCPP: chorusProId },
      );

      const historique = result?.listeHistoriqueStatutVo || result?.listeStatuts || [];
      const latest = historique.length > 0 ? (historique[historique.length - 1]?.statut || historique[historique.length - 1]?.libelleStatut) : null;
      if (latest) await supabaseAdmin.from('situations').update({ chorus_pro_status: latest }).eq('id', situationId).eq('tenant_id', tenantId);

      res.json({ history: historique, latest_status: latest || (sit as any)?.chorus_pro_status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/chorus-pro/situations — list local situations linked to an entreprise facture on Chorus Pro
  app.get('/api/chorus-pro/situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('situations')
        .select('*, marche:marches_entreprises(entreprise_nom,entreprise_siret,lot_numero,lot_titre,tva_rate,revision_active), projects(name)')
        .eq('tenant_id', tenantId)
        .not('chorus_pro_id', 'is', null)
        .order('date_situation', { ascending: false });
      if (error) throw error;
      const result = await Promise.all((data || []).map(async (s: any) => {
        const { data: details } = await supabaseAdmin.from('detail_situations').select('*').eq('tenant_id', tenantId).eq('situation_id', s.id);
        const net = computeEtatAcompte(s, s.marche, details ?? []);
        const project_name = s.projects?.name || null;
        const { projects: _p, ...rest } = s;
        return { ...rest, project_name, montant_ttc: net.net };
      }));
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── End Chorus Pro Integration ────────────────────────────────────────────

  // ─── Project Templates ─────────────────────────────────────────────────────
  app.get("/api/project-templates", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('project_templates').select('*').eq('tenant_id', tenantId).order('name');
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: "Failed to fetch project templates" }); }
  });

  app.post("/api/project-templates", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, name, description, default_status, default_budget, default_description } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('project_templates').insert({ id, tenant_id: tenantId, name, description, default_status: default_status || 'Planning', default_budget: default_budget || 0, default_description }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to create project template: " + e.message }); }
  });

  app.put("/api/project-templates/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, description, default_status, default_budget, default_description } = req.body;
      const { data, error } = await supabaseAdmin.from('project_templates').update({ name, description, default_status, default_budget, default_description }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update project template: " + e.message }); }
  });

  app.delete("/api/project-templates/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('project_templates').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete project template" }); }
  });

  // ─── ACT Data (Analyse Comparative des Offres) ────────────────────────────
  app.get("/api/projects/:projectId/act", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('act_data').select('*').eq('tenant_id', tenantId).eq('project_id', req.params.projectId).single();
      if (error && error.code !== 'PGRST116') throw error;
      res.json(data || null);
    } catch (e: any) { res.status(500).json({ error: "Failed to fetch ACT data" }); }
  });

  app.put("/api/projects/:projectId/act", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { companies, lots, scoring_criteria, weights, consultation, act_phase } = req.body;
      const { data: existing } = await supabaseAdmin.from('act_data').select('id').eq('tenant_id', tenantId).eq('project_id', req.params.projectId).single();
      const payload = { companies, lots, scoring_criteria, weights, consultation, act_phase, updated_at: new Date().toISOString() };
      if (existing) {
        const { data, error } = await supabaseAdmin.from('act_data').update(payload).eq('id', existing.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        res.json(data);
      } else {
        const { data, error } = await supabaseAdmin.from('act_data').insert({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: req.params.projectId, ...payload }).select().single();
        if (error) throw error;
        res.status(201).json(data);
      }
    } catch (e: any) { res.status(500).json({ error: "Failed to save ACT data: " + e.message }); }
  });

  // ─── DET Data (Comptes Rendus de Réunions) ────────────────────────────────
  app.get("/api/projects/:projectId/det", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('det_data').select('*').eq('tenant_id', tenantId).eq('project_id', req.params.projectId).order('created_at');
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: "Failed to fetch DET data" }); }
  });

  app.post("/api/projects/:projectId/det", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, info, observations, intervenants } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('det_data').insert({ id, tenant_id: tenantId, project_id: req.params.projectId, info, observations, intervenants }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to create CR: " + e.message }); }
  });

  app.put("/api/projects/:projectId/det/:crId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { info, observations, intervenants } = req.body;
      const { data, error } = await supabaseAdmin.from('det_data').update({ info, observations, intervenants }).eq('id', req.params.crId).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update CR: " + e.message }); }
  });

  app.delete("/api/projects/:projectId/det/:crId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('det_data').delete().eq('id', req.params.crId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete CR" }); }
  });

  // ─── DPGF Items CRUD (missing write operations) ───────────────────────────
  app.post("/api/dpgf", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, dpgf_id, lot_number, lot_title, item_number, description, unit, quantity, unit_price } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('dpgf_items').insert({ id, tenant_id: tenantId, project_id, dpgf_id, lot_number, lot_title, item_number, description, unit, quantity, unit_price }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to create DPGF item: " + e.message }); }
  });

  app.put("/api/dpgf/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { lot_number, lot_title, item_number, description, unit, quantity, unit_price } = req.body;
      const { data, error } = await supabaseAdmin.from('dpgf_items').update({ lot_number, lot_title, item_number, description, unit, quantity, unit_price }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update DPGF item: " + e.message }); }
  });

  app.delete("/api/dpgf/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('dpgf_items').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete DPGF item" }); }
  });

  // ─── DPGFs CRUD (missing write + update/delete) ───────────────────────────
  app.post("/api/dpgfs", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, version } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('dpgfs').insert({ id, tenant_id: tenantId, project_id, title, version }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to create DPGF: " + e.message }); }
  });

  app.put("/api/dpgfs/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, version } = req.body;
      const { data, error } = await supabaseAdmin.from('dpgfs').update({ title, version }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update DPGF: " + e.message }); }
  });

  app.delete("/api/dpgfs/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('dpgfs').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete DPGF" }); }
  });

  // ─── Situations CRUD (missing write operations) ───────────────────────────
  app.post("/api/situations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, numero, date_situation, statut } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('situations').insert({ id, tenant_id: tenantId, project_id, numero, date_situation, statut }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la situation N° ${numero}`, String(numero ?? ''), id, 'situation', 'Situations/DPGF');
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to create situation: " + e.message }); }
  });

  app.put("/api/situations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { numero, date_situation, statut } = req.body;
      const { data, error } = await supabaseAdmin.from('situations').update({ numero, date_situation, statut }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update situation: " + e.message }); }
  });

  app.delete("/api/situations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: situation } = await supabaseAdmin.from('situations').select('numero').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('situations').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      const numero = (situation as any)?.numero;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la situation N° ${numero}`, String(numero ?? ''), req.params.id, 'situation', 'Situations/DPGF');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete situation" }); }
  });

  // ─── Detail Situations CRUD (missing write operations) ────────────────────
  app.post("/api/detail-situations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, situation_id, dpgf_item_id, quantite_realisee, montant_situation } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('detail_situations').insert({ id, tenant_id: tenantId, situation_id, dpgf_item_id, quantite_realisee, montant_situation }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to create detail situation: " + e.message }); }
  });

  app.put("/api/detail-situations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { quantite_realisee, montant_situation } = req.body;
      const { data, error } = await supabaseAdmin.from('detail_situations').update({ quantite_realisee, montant_situation }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update detail situation: " + e.message }); }
  });

  app.delete("/api/detail-situations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('detail_situations').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete detail situation" }); }
  });

  // ─── Marchés Entreprises CRUD ─────────────────────────────────────────────

  app.get("/api/marches-entreprises/:projectId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('marches_entreprises')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('project_id', req.params.projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/marches-entreprises", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('marches_entreprises')
        .insert({ ...req.body, tenant_id: tenantId })
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/marches-entreprises/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('marches_entreprises')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/marches-entreprises/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin
        .from('marches_entreprises')
        .delete()
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/situations/:projectId/avec-marche — situations avec marché joint
  app.get("/api/situations/:projectId/avec-marche", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('situations')
        .select('*, marche:marches_entreprises(id,entreprise_nom,lot_numero,lot_titre,montant_ht,tva_rate,avance_pct,avance_montant_ttc,avance_remboursee_cumul,retenue_garantie_pct,retenue_garantie_bancaire,retenue_garantie_bancaire_montant,revision_active,revision_formule)')
        .eq('tenant_id', tenantId)
        .eq('project_id', req.params.projectId)
        .order('numero_situation', { ascending: true });
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/situations/:situationId/details-enhanced — details avec avancement N-1 auto-calculé
  app.get("/api/situations/:situationId/details-enhanced", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      // Récupérer la situation courante
      const { data: sit } = await supabaseAdmin
        .from('situations')
        .select('id, project_id, numero_situation, marche_id')
        .eq('id', req.params.situationId)
        .eq('tenant_id', tenantId)
        .single();

      if (!sit) return res.status(404).json({ error: 'situation not found' });

      // Récupérer les postes DPGF du projet
      const { data: dpgfItems } = await supabaseAdmin
        .from('dpgf_items')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('project_id', sit.project_id);

      // Récupérer les details de la situation courante
      const { data: details } = await supabaseAdmin
        .from('detail_situations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('situation_id', sit.id);

      // Récupérer la situation précédente pour N-1
      const { data: prevSit } = await supabaseAdmin
        .from('situations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('project_id', sit.project_id)
        .lt('numero_situation', sit.numero_situation)
        .order('numero_situation', { ascending: false })
        .limit(1)
        .maybeSingle();

      let prevDetails: any[] = [];
      if (prevSit) {
        const { data: pd } = await supabaseAdmin
          .from('detail_situations')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('situation_id', prevSit.id);
        prevDetails = pd ?? [];
      }

      // Enrichir chaque poste DPGF avec l'avancement N et N-1
      const enriched = (dpgfItems ?? []).map((item: any) => {
        const detail = details?.find((d: any) => d.dpgf_item_id === item.id);
        const prevDetail = prevDetails.find((d: any) => d.dpgf_item_id === item.id);
        const montantTotal = Number(item.prix_unitaire_ht) * Number(item.quantite_prevue);
        const avancement_n = detail ? Number(detail.pourcentage_avancement || 0) : 0;
        const avancement_n_moins_1 = prevDetail ? Number(prevDetail.pourcentage_avancement || 0) : 0;
        const montant_cumul_n = montantTotal * avancement_n / 100;
        const montant_cumul_n_moins_1 = montantTotal * avancement_n_moins_1 / 100;
        const montant_periode = montant_cumul_n - montant_cumul_n_moins_1;
        return {
          ...item,
          montant_total: montantTotal,
          detail_id: detail?.id ?? null,
          avancement_n,
          avancement_n_moins_1,
          montant_cumul_n,
          montant_cumul_n_moins_1,
          montant_periode,
        };
      });

      res.json({ situation: sit, items: enriched });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/situations/:situationId/detail-bulk — upsert tous les détails d'un coup
  app.post("/api/situations/:situationId/detail-bulk", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { items } = req.body as { items: Array<{ dpgf_item_id: string; pourcentage_avancement: number; montant_periode: number }> };

      // Supprimer les anciens détails
      await supabaseAdmin
        .from('detail_situations')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('situation_id', req.params.situationId);

      if (!items?.length) return res.json({ success: true });

      const rows = items.map(i => ({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        situation_id: req.params.situationId,
        dpgf_item_id: i.dpgf_item_id,
        pourcentage_avancement: i.pourcentage_avancement,
        montant_situation: i.montant_periode,
        montant_periode: i.montant_periode,
      }));

      const { error } = await supabaseAdmin.from('detail_situations').insert(rows);
      if (error) throw error;
      res.json({ success: true, count: rows.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/situations/:id/etat-acompte — màj des champs état d'acompte
  app.put("/api/situations/:id/etat-acompte", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        marche_id, date_reception_situation, penalites_ht, penalites_notes,
        avance_remboursement, revision_coeff, revision_indices, notes_moe, etat,
      } = req.body;
      const { data, error } = await supabaseAdmin
        .from('situations')
        .update({
          marche_id, date_reception_situation, penalites_ht, penalites_notes,
          avance_remboursement, revision_coeff, revision_indices, notes_moe, etat,
        })
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Calcul de l'état d'acompte d'une situation de travaux (partagé entre le PDF
  // et le dépôt Chorus Pro) : décompte HT → révision → TVA → TTC → net à payer.
  function computeEtatAcompte(sit: any, marche: any, details: any[]) {
    const montantHt = details.reduce((s: number, d: any) => s + Number(d.montant_situation || d.montant_periode || 0), 0);
    const coeff = Number(sit.revision_coeff ?? 1);
    const revisionMontant = marche?.revision_active ? montantHt * (coeff - 1) : 0;
    const htRevise = montantHt + revisionMontant;
    const tvaRate = Number(marche?.tva_rate ?? 20) / 100;
    const tva = htRevise * tvaRate;
    const ttc = htRevise + tva;
    const retenue = Number(sit.retenue_garantie_pct ?? marche?.retenue_garantie_pct ?? 5) / 100 * ttc;
    const avanceRemb = Number(sit.avance_remboursement ?? 0);
    const penalites = Number(sit.penalites_ht ?? 0);
    const net = ttc - retenue - avanceRemb - penalites;
    return { montantHt, coeff, revisionMontant, htRevise, tvaRate, tva, ttc, retenue, avanceRemb, penalites, net };
  }

  // Génère le PDF de l'état d'acompte — partagé entre le téléchargement direct
  // et le dépôt en pièce jointe complémentaire sur Chorus Pro.
  async function buildEtatAcomptePdfBuffer(sit: any, marche: any, details: any[], agencyName: string): Promise<Buffer> {
    const { montantHt, coeff, revisionMontant, htRevise, tva, ttc, retenue, avanceRemb, penalites, net } = computeEtatAcompte(sit, marche, details);

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    pdf.setFontSize(16); pdf.setFont('helvetica', 'bold');
    pdf.text(`ÉTAT D'ACOMPTE N°${sit.numero_situation}`, 20, 20);
    pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
    if (agencyName) pdf.text(`Architecte : ${agencyName}`, 20, 30);
    pdf.text(`Date situation : ${new Date(sit.date_situation).toLocaleDateString('fr-FR')}`, 20, 36);
    if (marche) {
      pdf.text(`Entreprise : ${marche.entreprise_nom}`, 20, 42);
      pdf.text(`Lot : ${marche.lot_numero} — ${marche.lot_titre}`, 20, 48);
      pdf.text(`Marché HT : ${Number(marche.montant_ht).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`, 20, 54);
    }

    const f = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    autoTable(pdf, {
      startY: 65,
      head: [['', 'Montant HT']],
      body: [
        ['Décompte mensuel (travaux de la période)', `${f(montantHt)} €`],
        ...(marche?.revision_active ? [
          [`Révision des prix (Cn = ${coeff.toFixed(6)})`, `${revisionMontant >= 0 ? '+' : ''}${f(revisionMontant)} €`],
          ['Total HT révisé', `${f(htRevise)} €`],
        ] : []),
        [`TVA ${marche?.tva_rate ?? 20} %`, `+ ${f(tva)} €`],
        ['─────────────────────────────', ''],
        ['TOTAL TTC', `${f(ttc)} €`],
        ['─────────────────────────────', ''],
        [`Retenue de garantie ${marche?.retenue_garantie_pct ?? 5} %`, `- ${f(retenue)} €`],
        ...(avanceRemb > 0 ? [['Remboursement avance', `- ${f(avanceRemb)} €`]] : []),
        ...(penalites > 0 ? [['Pénalités de retard', `- ${f(penalites)} €`]] : []),
        ['─────────────────────────────', ''],
        ['NET À PAYER TTC', `${f(net)} €`],
      ],
      styles: { fontSize: 10 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (data: any) => {
        if (data.row.raw[0] === 'NET À PAYER TTC' || data.row.raw[0] === 'TOTAL TTC') {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    // Annexe : détail postes
    if (details.length > 0) {
      (pdf as any).addPage();
      pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
      pdf.text('DÉTAIL DU DÉCOMPTE MENSUEL', 20, 20);
      autoTable(pdf, {
        startY: 28,
        head: [['Désignation', 'U', 'Qté', 'P.U. HT', 'Av. N-1 %', 'Av. N %', 'Montant période HT']],
        body: details.map((d: any) => {
          const item = d.dpgf_item;
          return [
            item?.designation ?? '—',
            item?.unite ?? '—',
            item?.quantite_prevue ?? '—',
            item ? `${f(item.prix_unitaire_ht)} €` : '—',
            d.avancement_n_moins_1 ? `${d.avancement_n_moins_1}%` : '0%',
            `${d.pourcentage_avancement ?? 0}%`,
            `${f(Number(d.montant_situation || d.montant_periode || 0))} €`,
          ];
        }),
        foot: [['', '', '', '', '', 'Total HT', `${f(montantHt)} €`]],
        styles: { fontSize: 8 },
        columnStyles: { 6: { halign: 'right' } },
      });
    }

    return Buffer.from(pdf.output('arraybuffer'));
  }

  // GET /api/situations/:situationId/etat-acompte-pdf — PDF état d'acompte
  app.get("/api/situations/:situationId/etat-acompte-pdf", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      const { data: sit } = await supabaseAdmin
        .from('situations')
        .select('*, marche:marches_entreprises(*)')
        .eq('id', req.params.situationId)
        .eq('tenant_id', tenantId)
        .single();

      if (!sit) return res.status(404).json({ error: 'not found' });

      const marche = (sit as any).marche as any;
      const { data: detailsRaw } = await supabaseAdmin
        .from('detail_situations')
        .select('*, dpgf_item:dpgf_items(designation, prix_unitaire_ht, quantite_prevue, unite)')
        .eq('tenant_id', tenantId)
        .eq('situation_id', sit.id);

      const details = detailsRaw ?? [];
      const { data: cfg } = await supabaseAdmin.from('settings').select('agency_name').eq('tenant_id', tenantId).single();
      const agencyName = (cfg as any)?.agency_name ?? '';

      const buf = await buildEtatAcomptePdfBuffer(sit, marche, details, agencyName);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="etat-acompte-${sit.numero_situation}.pdf"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── CCTPs CRUD (missing update/delete) ──────────────────────────────────
  app.put("/api/cctps/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, content, lot, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { data, error } = await supabaseAdmin.from('cctps').update({ title, content, lot, is_template: !!is_template, last_updated }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: "Failed to update CCTP: " + e.message }); }
  });

  app.delete("/api/cctps/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('cctps').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: "Failed to delete CCTP" }); }
  });

  // ─── Stancer Billing ──────────────────────────────────────────────────────

  const STANCER_API_BASE = 'https://api.stancer.com/v2';

  function stancerAuthHeader(): string {
    const key = process.env.STANCER_SECRET_KEY || '';
    return 'Basic ' + Buffer.from(key + ':').toString('base64');
  }

  async function stancerFetch(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
    const res = await fetch(`${STANCER_API_BASE}${path}`, {
      method: opts.method || 'GET',
      headers: {
        Authorization: stancerAuthHeader(),
        'Content-Type': 'application/json',
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    return res.json();
  }

  // GET /api/billing/status
  app.get('/api/billing/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: tenant } = await supabaseAdmin.from('tenants')
        .select('plan, trial_ends_at, stancer_customer_id, ai_credit_balance_eur_cents').eq('id', tenantId).single();
      const [projectsRes, usersRes, docsRes] = await Promise.all([
        supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabaseAdmin.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);
      const plan = (tenant as any)?.plan || 'trial';
      const trial_ends_at = (tenant as any)?.trial_ends_at ?? null;
      const isTrial = plan === 'trial';
      const is_expired = isTrial && trial_ends_at && new Date(trial_ends_at) < new Date();
      const effectivePlan = is_expired ? 'expired' : plan;
      const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.trial;
      res.json({
        plan: effectivePlan,
        trial_ends_at,
        is_expired: !!is_expired,
        usage: {
          projects:  { used: projectsRes.count ?? 0, limit: limits.projects },
          users:     { used: usersRes.count ?? 0, limit: limits.users },
          documents: { used: docsRes.count ?? 0, limit: limits.documents },
        },
        ai_credits: {
          balance_eur_cents: (tenant as any)?.ai_credit_balance_eur_cents ?? 0,
          included_monthly_cents: PLAN_AI_MONTHLY_CREDIT_CENTS[effectivePlan] ?? 0,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/billing/checkout — create Stancer payment, return redirect URL
  app.post('/api/billing/checkout', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { plan_id } = req.body;
      const PLAN_PRICES: Record<string, number> = { starter: 2900, pro: 5900 };
      const PLAN_NAMES: Record<string, string> = { starter: 'Starter', pro: 'Pro' };
      const amount = PLAN_PRICES[plan_id];
      if (!amount) return res.status(400).json({ error: 'Plan invalide ou contact commercial requis' });

      const { data: tenant } = await supabaseAdmin.from('tenants').select('name, stancer_customer_id').eq('id', tenantId).single();

      // Create or reuse Stancer customer
      let customerId = (tenant as any)?.stancer_customer_id;
      if (!customerId) {
        const customer = await stancerFetch('/customers', {
          method: 'POST',
          body: { name: (tenant as any)?.name || 'Client', email: req.user.email },
        });
        customerId = customer.id;
        if (customerId) {
          await supabaseAdmin.from('tenants').update({ stancer_customer_id: customerId }).eq('id', tenantId);
        }
      }

      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const returnUrl = `${proto}://${host}/billing?payment_status=success&plan=${plan_id}`;

      // Create payment
      const paymentBody: any = {
        amount,
        currency: 'eur',
        description: `ArchiOffice ${PLAN_NAMES[plan_id]} — Mensuel`,
        return_url: returnUrl,
      };
      if (customerId) paymentBody.customer = customerId;

      const payment = await stancerFetch('/payments', { method: 'POST', body: paymentBody });
      if (!payment.id) {
        console.error('[Stancer checkout]', payment);
        return res.status(502).json({ error: 'Erreur Stancer lors de la création du paiement' });
      }

      // Record pending payment
      await supabaseAdmin.from('billing_events').insert({
        tenant_id: tenantId,
        event_type: 'checkout_created',
        stancer_payment_id: payment.id,
        plan_id,
        amount,
        status: 'pending',
      });

      const pubKey = process.env.STANCER_PUBLIC_KEY || '';
      const paymentUrl = `https://payment.stancer.com/${pubKey}/${payment.id}`;

      res.json({ payment_id: payment.id, payment_url: paymentUrl });
    } catch (e: any) {
      console.error('[Billing checkout error]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/billing/webhook — Stancer event delivery (no JWT auth)
  app.post('/api/billing/webhook', express.json(), async (req: any, res: any) => {
    try {
      const event = req.body;
      const paymentId = event.id || event.payment?.id;
      if (!paymentId) return res.json({ received: true });

      console.log('[Stancer webhook] event received, payment:', paymentId);

      // Verify by re-fetching from Stancer API
      const payment = await stancerFetch(`/payments/${paymentId}`);
      const status = payment?.status;

      if (status === 'captured' || status === 'authorized') {
        const { data: billingEvent } = await supabaseAdmin
          .from('billing_events')
          .select('*')
          .eq('stancer_payment_id', paymentId)
          .maybeSingle();

        if (billingEvent) {
          const { tenant_id, plan_id, event_type, credit_pack_id } = billingEvent as any;

          if (event_type === 'credit_topup_created') {
            // Credit top-up: add EUR cents to tenant balance
            const pack = AI_CREDIT_PACKS[credit_pack_id];
            if (pack) {
              await supabaseAdmin.rpc('increment_ai_credits', { p_tenant_id: tenant_id, p_amount_cents: pack.amount_cents });
              console.log(`[Stancer webhook] AI credits +${pack.amount_cents} cents for tenant ${tenant_id}`);
            }
            await supabaseAdmin.from('billing_events').update({ status: 'paid' }).eq('id', (billingEvent as any).id);
          } else {
            // Plan activation
            const renewalDate = new Date();
            renewalDate.setMonth(renewalDate.getMonth() + 1);
            await supabaseAdmin.from('tenants').update({
              plan: plan_id,
              trial_ends_at: renewalDate.toISOString(),
            }).eq('id', tenant_id);
            await supabaseAdmin.from('billing_events').update({ status: 'paid' }).eq('id', (billingEvent as any).id);
            console.log(`[Stancer webhook] Plan ${plan_id} activated for tenant ${tenant_id}`);
          }
        }
      }

      if (status === 'failed' || status === 'refused') {
        const { data: billingEvent } = await supabaseAdmin
          .from('billing_events')
          .select('id')
          .eq('stancer_payment_id', paymentId)
          .maybeSingle();
        if (billingEvent) {
          await supabaseAdmin.from('billing_events').update({ status: 'failed' }).eq('id', (billingEvent as any).id);
        }
      }

      res.json({ received: true });
    } catch (e: any) {
      console.error('[Stancer webhook error]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/billing/history — payment history for current tenant
  app.get('/api/billing/history', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await supabaseAdmin
        .from('billing_events')
        .select('id, event_type, plan_id, amount, status, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20);
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/billing/credits/packs — available top-up packs
  app.get('/api/billing/credits/packs', (_req: any, res: any) => {
    res.json(Object.entries(AI_CREDIT_PACKS).map(([id, p]) => ({ id, amount_cents: p.amount_cents, label: p.label })));
  });

  // POST /api/billing/credits/checkout — buy a credit pack via Stancer
  app.post('/api/billing/credits/checkout', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { pack_id } = req.body;
      const pack = AI_CREDIT_PACKS[pack_id];
      if (!pack) return res.status(400).json({ error: 'Pack invalide' });

      const { data: tenant } = await supabaseAdmin.from('tenants').select('name, stancer_customer_id').eq('id', tenantId).single();

      let customerId = (tenant as any)?.stancer_customer_id;
      if (!customerId) {
        const customer = await stancerFetch('/customers', {
          method: 'POST',
          body: { name: (tenant as any)?.name || 'Client', email: req.user.email },
        });
        customerId = customer.id;
        if (customerId) {
          await supabaseAdmin.from('tenants').update({ stancer_customer_id: customerId }).eq('id', tenantId);
        }
      }

      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const returnUrl = `${proto}://${host}/billing?payment_status=success&type=credit&pack=${pack_id}`;

      const paymentBody: any = {
        amount: pack.amount_cents,
        currency: 'eur',
        description: `ArchiOffice Crédits IA — ${pack.label}`,
        return_url: returnUrl,
      };
      if (customerId) paymentBody.customer = customerId;

      const payment = await stancerFetch('/payments', { method: 'POST', body: paymentBody });
      if (!payment.id) {
        console.error('[Stancer credits checkout]', payment);
        return res.status(502).json({ error: 'Erreur Stancer lors de la création du paiement' });
      }

      await supabaseAdmin.from('billing_events').insert({
        tenant_id: tenantId,
        event_type: 'credit_topup_created',
        stancer_payment_id: payment.id,
        credit_pack_id: pack_id,
        plan_id: null,
        amount: pack.amount_cents,
        status: 'pending',
      });

      const pubKey = process.env.STANCER_PUBLIC_KEY || '';
      res.json({ payment_id: payment.id, payment_url: `https://payment.stancer.com/${pubKey}/${payment.id}` });
    } catch (e: any) {
      console.error('[Credits checkout error]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── End Stancer Billing ───────────────────────────────────────────────────

  // ─── Custom References (références hors projets) ──────────────────────────

  app.get('/api/references/custom', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('custom_references')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('end_date', { ascending: false });
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/references/custom', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, client, category, end_date, surface, budget, status, description, image_url, location, start_date, project_manager, construction_cost, remuneration, progression, custom_data } = req.body;
      if (!name) return res.status(400).json({ error: 'name requis' });
      const { data, error } = await supabaseAdmin
        .from('custom_references')
        .insert({ tenant_id: tenantId, name, client, category, end_date: end_date || null, surface: surface || null, budget: budget || null, status: status || 'Completed', description, image_url, location, start_date: start_date || null, project_manager, construction_cost: construction_cost || null, remuneration: remuneration || null, progression: progression || null, custom_data: custom_data || {} })
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/references/custom/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, client, category, end_date, surface, budget, status, description, image_url, location, start_date, project_manager, construction_cost, remuneration, progression, custom_data } = req.body;
      const { data, error } = await supabaseAdmin
        .from('custom_references')
        .update({ name, client, category, end_date: end_date || null, surface: surface || null, budget: budget || null, status, description, image_url, location, start_date: start_date || null, project_manager, construction_cost: construction_cost || null, remuneration: remuneration || null, progression: progression || null, custom_data: custom_data || {} })
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/references/custom/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin
        .from('custom_references')
        .delete()
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/references/custom/bulk', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { items } = req.body as { items: any[] };
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items provided' });
      const rows = items.map(({ name, client, category, end_date, surface, budget, status, description, image_url, location }) => ({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        name: name || 'Sans titre',
        client: client || '',
        category: category || '',
        end_date: end_date || null,
        surface: surface != null ? Number(surface) : null,
        budget: budget != null ? Number(budget) : null,
        status: status || 'Completed',
        description: description || '',
        image_url: image_url || null,
        location: location || '',
      }));
      const { data, error } = await supabaseAdmin.from('custom_references').insert(rows).select();
      if (error) {
        if (error.code === '42P01') return res.json([]);
        throw error;
      }
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── End Custom References ────────────────────────────────────────────────

  // ─── Super-Admin Dashboard ────────────────────────────────────────────────

  function requireSuperAdmin(req: any, res: any, next: any) {
    const adminEmail = process.env.SUPER_ADMIN_EMAIL;
    if (!adminEmail || req.user?.email !== adminEmail) {
      return res.status(403).json({ error: 'Accès réservé au super-administrateur' });
    }
    next();
  }

  app.get('/api/admin/is-admin', async (req: any, res: any) => {
    const adminEmail = process.env.SUPER_ADMIN_EMAIL;
    res.json({ isAdmin: !!(adminEmail && req.user?.email === adminEmail) });
  });

  app.get('/api/admin/stats', requireSuperAdmin, async (_req: any, res: any) => {
    try {
      const [{ data: tenants }, { data: revenue }, { data: aiRevenue }] = await Promise.all([
        supabaseAdmin.from('tenants').select('id, plan, trial_ends_at'),
        supabaseAdmin.from('billing_events').select('amount, created_at, event_type').eq('status', 'paid'),
        supabaseAdmin.from('billing_events').select('amount, created_at').eq('status', 'paid').eq('event_type', 'credit_topup_created'),
      ]);
      const now = Date.now();
      const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 7);
      const planRevenue = (revenue ?? []).filter((e: any) => e.event_type !== 'credit_topup_created');
      const stats = {
        total:      tenants?.length ?? 0,
        trial:      tenants?.filter(t => t.plan === 'trial').length ?? 0,
        starter:    tenants?.filter(t => t.plan === 'starter').length ?? 0,
        pro:        tenants?.filter(t => t.plan === 'pro').length ?? 0,
        enterprise: tenants?.filter(t => t.plan === 'enterprise').length ?? 0,
        expired:    tenants?.filter(t => t.plan === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at).getTime() < now).length ?? 0,
        totalRevenue:    (planRevenue.reduce((s: number, e: any) => s + (e.amount ?? 0), 0) / 100),
        totalAiRevenue:  ((aiRevenue ?? []).reduce((s, e) => s + (e.amount ?? 0), 0) / 100),
        aiRevenueThisMonth: ((aiRevenue ?? []).filter((e: any) => (e.created_at as string).slice(0, 7) === thisMonth).reduce((s, e) => s + (e.amount ?? 0), 0) / 100),
      };
      const monthlyRevenue: Record<string, number> = {};
      for (const e of planRevenue) {
        const month = (e.created_at as string).slice(0, 7);
        monthlyRevenue[month] = (monthlyRevenue[month] ?? 0) + (e.amount ?? 0) / 100;
      }
      res.json({ stats, monthlyRevenue });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/tenants', requireSuperAdmin, async (_req: any, res: any) => {
    try {
      const { data: tenants, error } = await supabaseAdmin
        .from('tenants')
        .select('id, slug, name, plan, trial_ends_at, created_at, ai_credit_balance_eur_cents')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const enriched = await Promise.all((tenants ?? []).map(async (t) => {
        const [profilesRes, projectsRes, ownerRes] = await Promise.all([
          supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabaseAdmin.from('profiles').select('email, name').eq('tenant_id', t.id).eq('system_role', 'admin').limit(1),
        ]);
        const owner = ownerRes.data?.[0];
        return {
          ...t,
          user_count: profilesRes.count ?? 0,
          project_count: projectsRes.count ?? 0,
          owner_email: owner?.email ?? null,
          owner_name: owner?.name ?? null,
        };
      }));
      res.json(enriched);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/plan', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { plan } = req.body;
      if (!['trial', 'starter', 'pro', 'enterprise'].includes(plan)) {
        return res.status(400).json({ error: 'Plan invalide' });
      }
      const { error } = await supabaseAdmin.from('tenants').update({ plan }).eq('id', req.params.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/trial', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { days } = req.body;
      if (typeof days !== 'number' || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Durée invalide (1-365 jours)' });
      }
      const newDate = new Date(Date.now() + days * 86_400_000).toISOString();
      const { error } = await supabaseAdmin.from('tenants').update({ trial_ends_at: newDate, plan: 'trial' }).eq('id', req.params.id);
      if (error) throw error;
      res.json({ ok: true, trial_ends_at: newDate });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch('/api/admin/tenants/:id/ai-credit', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { amount_cents } = req.body;
      if (typeof amount_cents !== 'number' || !Number.isFinite(amount_cents) || Math.round(amount_cents) === 0) {
        return res.status(400).json({ error: 'Montant invalide' });
      }
      const { error: rpcErr } = await supabaseAdmin.rpc('increment_ai_credits', { p_tenant_id: req.params.id, p_amount_cents: Math.round(amount_cents) });
      if (rpcErr) throw rpcErr;
      const { data: tenant, error } = await supabaseAdmin.from('tenants').select('ai_credit_balance_eur_cents').eq('id', req.params.id).single();
      if (error) throw error;
      res.json({ ok: true, balance_eur_cents: (tenant as any).ai_credit_balance_eur_cents });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/tenants', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { name, slug, adminEmail, adminName, plan = 'trial' } = req.body;
      if (!name || !slug || !adminEmail || !adminName) {
        return res.status(400).json({ error: 'name, slug, adminEmail et adminName sont requis' });
      }
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const { data: existing } = await supabaseAdmin.from('tenants').select('id').eq('slug', cleanSlug).maybeSingle();
      if (existing) return res.status(400).json({ error: `Le slug "${cleanSlug}" est déjà utilisé` });

      const tenantId = crypto.randomUUID();
      const trialEndsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const { error: tenantErr } = await supabaseAdmin.from('tenants').insert({ id: tenantId, slug: cleanSlug, name, plan, trial_ends_at: trialEndsAt });
      if (tenantErr) throw tenantErr;

      const tempPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail, password: tempPassword, user_metadata: { name: adminName }, email_confirm: true,
      });
      if (authErr || !authData?.user) throw authErr ?? new Error('Création utilisateur échouée');

      await supabaseAdmin.from('profiles').upsert({
        id: authData.user.id, tenant_id: tenantId, name: adminName, email: adminEmail,
        role: 'Admin', system_role: 'admin',
      });

      res.status(201).json({ tenantId, slug: cleanSlug, tempPassword });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/admin/tenants/:id', requireSuperAdmin, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { data: profiles } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', id);
      for (const p of profiles ?? []) {
        await supabaseAdmin.auth.admin.deleteUser(p.id).catch(() => {});
      }
      const { error } = await supabaseAdmin.from('tenants').delete().eq('id', id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── End Super-Admin Dashboard ────────────────────────────────────────────

  // ─── Project Members (per-project access control) ─────────────────────────
  app.get("/api/projects/:id/members", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('project_members')
        .select('*')
        .eq('project_id', req.params.id)
        .eq('tenant_id', tenantId);
      if (error) { res.json([]); return; }
      res.json(data || []);
    } catch (e: any) { console.error(e); res.json([]); }
  });

  app.post("/api/projects/:id/members", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { user_id, role } = req.body;
      if (!user_id) return res.status(400).json({ error: "user_id is required" });
      const { data, error } = await supabaseAdmin.from('project_members').insert({
        id: crypto.randomUUID(), project_id: req.params.id, user_id, role: role || 'member', tenant_id: tenantId
      }).select().single();
      if (error) {
        if ((error as any).code === '42P01') return res.status(503).json({ error: "Migration project_members non appliquée" });
        throw error;
      }
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to add project member" }); }
  });

  app.delete("/api/projects/:id/members/:userId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('project_members')
        .delete()
        .eq('project_id', req.params.id)
        .eq('user_id', req.params.userId)
        .eq('tenant_id', tenantId);
      if (error) {
        if ((error as any).code === '42P01') { res.json({ success: true }); return; }
        throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to remove project member" }); }
  });

  // ─── Global Search ─────────────────────────────────────────────────────────
  app.get("/api/search", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const q = (req.query.q as string || '').trim();
      if (!q || q.length < 2) return res.json({ projects: [], contacts: [], tenders: [], invoices: [] });

      const pattern = `%${q}%`;

      const [projectsRes, contactsRes, tendersRes, invoicesRes] = await Promise.all([
        supabaseAdmin.from('projects').select('id, name, client, status, address')
          .eq('tenant_id', tenantId)
          .or(`name.ilike.${pattern},client.ilike.${pattern},address.ilike.${pattern},description.ilike.${pattern}`)
          .limit(8),
        supabaseAdmin.from('contacts').select('id, first_name, last_name, company, email')
          .eq('tenant_id', tenantId)
          .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`)
          .limit(8),
        supabaseAdmin.from('tenders').select('id, title, client, status, type')
          .eq('tenant_id', tenantId)
          .or(`title.ilike.${pattern},client.ilike.${pattern}`)
          .limit(8),
        supabaseAdmin.from('invoices').select('id, invoice_number, project_name, status')
          .eq('tenant_id', tenantId)
          .or(`invoice_number.ilike.${pattern},project_name.ilike.${pattern}`)
          .limit(8),
      ]);

      res.json({
        projects: (projectsRes.data || []).map((p: any) => ({ ...p, _type: 'project', _url: `/projects/${p.id}`, _label: p.name })),
        contacts: (contactsRes.data || []).map((c: any) => ({ ...c, _type: 'contact', _url: '/contacts', _label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company })),
        tenders: (tendersRes.data || []).map((t: any) => ({ ...t, _type: 'tender', _url: `/tenders/${t.id}`, _label: t.title })),
        invoices: (invoicesRes.data || []).map((i: any) => ({ ...i, _type: 'invoice', _url: '/invoices', _label: i.invoice_number || i.project_name })),
      });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Search failed" }); }
  });

  // ─── AI: CCTP Article Suggestions ──────────────────────────────────────────
  app.post("/api/ai/suggest-articles", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { lot_name, existing_articles = [] } = req.body;
      if (!lot_name) return res.status(400).json({ error: "lot_name is required" });

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Gemini API key not configured" });

      // Refresh monthly allowance if needed, then check balance
      const { plan } = await getTenantPlan(tenantId);
      await maybeRefreshMonthlyCredits(tenantId, plan);

      const { data: tenantData } = await supabaseAdmin.from('tenants')
        .select('ai_credit_balance_eur_cents, agent_billing_mode').eq('id', tenantId).single();
      const billingMode = (tenantData as any)?.agent_billing_mode ?? 'prepaid';
      const balance = (tenantData as any)?.ai_credit_balance_eur_cents ?? 0;
      if (billingMode === 'prepaid' && balance <= 0) {
        return res.status(402).json({ error: 'Crédit IA épuisé. Veuillez recharger votre compte.', code: 'NO_TOKENS' });
      }

      const { GoogleGenAI } = await import("@google/genai");
      const genai = new GoogleGenAI({ apiKey });

      const existingList = existing_articles.length > 0 ? `\nArticles déjà présents (à ne pas dupliquer) : ${existing_articles.join(', ')}` : '';
      const prompt = `Tu es un expert en architecture et construction.
Génère exactement 5 articles techniques pour le lot "${lot_name}" dans un CCTP (Cahier des Clauses Techniques Particulières) architectural français.${existingList}

Réponds UNIQUEMENT avec un tableau JSON valide (sans markdown, sans explication), chaque élément ayant ces champs :
- "numero": numéro de l'article (ex: "1.1")
- "designation": nom court de l'article (ex: "Fourniture et pose de cloisons")
- "description": description technique détaillée (2-3 phrases)
- "unite": unité de mesure (m², ml, u, forfait, etc.)
- "prescriptionsTechniques": normes et prescriptions techniques applicables (1-2 phrases)`;

      const result = await genai.models.generateContent({ model: "gemini-3-flash-preview", contents: prompt });
      const text = result.text ?? '';

      // Track token usage and deduct cost
      const inputTokens  = (result as any).usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = (result as any).usageMetadata?.candidatesTokenCount ?? 0;
      if (inputTokens + outputTokens > 0) {
        await deductAiCredit({
          tenantId, userId: req.user.id,
          agentId: null, conversationId: null,
          endpointType: 'suggest_articles',
          inputTokens, outputTokens,
        });
      }

      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return res.status(500).json({ error: "Invalid AI response format" });

      const articles = JSON.parse(jsonMatch[0]);
      res.json({ articles });
    } catch (e: any) {
      console.error("AI suggest-articles error:", e.message);
      Sentry.captureException(e, { tags: { feature: 'ai-suggest-articles' } });
      res.status(500).json({ error: "AI suggestion failed: " + e.message });
    }
  });

  // ── Agents IA ─────────────────────────────────────────────────────────────
  // Logique métier dans @zinkh/archioffice-agents (package privé, licence propriétaire)
  const { registerAgentRoutes } = await import('@zinkh/archioffice-agents/server');
  registerAgentRoutes(app, supabaseAdmin, getTenantId, getTenantPlan, {
    deductAiCredit,
    maybeRefreshMonthlyCredits,
    PLAN_AI_MONTHLY_CREDIT_CENTS,
    baseUrl: `http://127.0.0.1:${PORT}`,
  });


  // ── Meetings ──────────────────────────────────────────────────────────────

  app.get("/api/meetings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, proposal_id, tender_id, type } = req.query;
      let query = supabaseAdmin.from('meetings').select('*').eq('tenant_id', tenantId).order('date', { ascending: false });
      if (project_id) query = query.eq('project_id', project_id);
      else if (proposal_id) query = query.eq('proposal_id', proposal_id);
      else if (tender_id) query = query.eq('tender_id', tender_id);
      if (type) query = query.eq('type', type);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/meetings/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: meeting, error } = await supabaseAdmin.from('meetings').select('*').eq('id', id).eq('tenant_id', tenantId).single();
      if (error) throw error;
      const { data: photos } = await supabaseAdmin.from('meeting_photos').select('*').eq('meeting_id', id).eq('tenant_id', tenantId).order('uploaded_at');
      res.json({ ...meeting, photos: photos || [] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/meetings", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, proposal_id, tender_id, type, title, date, notes } = req.body;
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('meetings').insert({ id, tenant_id: tenantId, project_id: project_id || null, proposal_id: proposal_id || null, tender_id: tender_id || null, type: type || 'projet', title, date, notes: notes || null, created_at });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réunion "${title}"`, title, id, 'meeting', 'Réunions');
      res.status(201).json({ id, project_id, proposal_id, tender_id, type: type || 'projet', title, date, notes, created_at, photos: [] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/meetings/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, date, notes } = req.body;
      const updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('meetings').update({ title, date, notes: notes || null, updated_at }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/meetings/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: meeting } = await supabaseAdmin.from('meetings').select('title').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { data: photos } = await supabaseAdmin.from('meeting_photos').select('file_url').eq('meeting_id', id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('meeting_photos').delete().eq('meeting_id', id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('meetings').delete().eq('id', id).eq('tenant_id', tenantId);
      if (photos?.length) {
        for (const p of photos) deleteFromStorage('meeting-photos', p.file_url).catch(() => {});
      }
      const title = (meeting as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réunion "${title}"`, title, id, 'meeting', 'Réunions');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/meetings/:id/photos", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { caption } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const photoId = crypto.randomUUID();
      const storagePath = `${tenantId}/${id}/${photoId}-${sanitizeFilename(file.originalname)}`;
      const file_url = await uploadToStorage('meeting-photos', storagePath, file.buffer, file.mimetype);
      const uploaded_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('meeting_photos').insert({ id: photoId, meeting_id: id, tenant_id: tenantId, file_url, caption: caption || null, uploaded_at });
      if (error) throw error;
      res.status(201).json({ id: photoId, meeting_id: id, file_url, caption, uploaded_at });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/meetings/:meetingId/photos/:photoId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { meetingId, photoId } = req.params;
      const { data: photo } = await supabaseAdmin.from('meeting_photos').select('file_url').eq('id', photoId).eq('meeting_id', meetingId).eq('tenant_id', tenantId).single();
      await supabaseAdmin.from('meeting_photos').delete().eq('id', photoId).eq('tenant_id', tenantId);
      if (photo?.file_url) deleteFromStorage('meeting-photos', photo.file_url).catch(() => {});
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/meetings/photos/:photoId/caption", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { photoId } = req.params;
      const { caption } = req.body;
      const { error } = await supabaseAdmin.from('meeting_photos').update({ caption }).eq('id', photoId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Meeting Attendees ──────────────────────────────────────────────────────

  app.get("/api/meetings/:id/attendees", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: attendees, error } = await supabaseAdmin
        .from('meeting_attendees')
        .select('id, contact_id, role')
        .eq('meeting_id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      if (!attendees?.length) return res.json([]);
      const contactIds = attendees.map((a: any) => a.contact_id);
      const { data: contacts } = await supabaseAdmin
        .from('contacts')
        .select('id, first_name, last_name, company_name, job_title, phone_mobile, phone_work, phone, email, email_work, email_home')
        .in('id', contactIds)
        .eq('tenant_id', tenantId);
      const contactMap: Record<string, any> = {};
      (contacts || []).forEach((c: any) => { contactMap[c.id] = c; });
      res.json(attendees.map((a: any) => ({ ...a, contact: contactMap[a.contact_id] || null })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Add existing contact as attendee
  app.post("/api/meetings/:id/attendees", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { contact_id, role } = req.body;
      if (!contact_id) return res.status(400).json({ error: "contact_id required" });
      // Check no duplicate
      const { data: existing } = await supabaseAdmin
        .from('meeting_attendees')
        .select('id')
        .eq('meeting_id', id)
        .eq('contact_id', contact_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (existing) return res.status(409).json({ error: "Already added" });
      const attendeeId = crypto.randomUUID();
      const { error } = await supabaseAdmin
        .from('meeting_attendees')
        .insert({ id: attendeeId, meeting_id: id, tenant_id: tenantId, contact_id, role: role || null });
      if (error) throw error;
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('id, first_name, last_name, company_name, job_title, phone_mobile, phone_work, phone, email, email_work, email_home')
        .eq('id', contact_id)
        .eq('tenant_id', tenantId)
        .single();
      res.status(201).json({ id: attendeeId, contact_id, role, contact });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Create new contact and add as attendee
  app.post("/api/meetings/:id/attendees/new-contact", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { first_name, last_name, company_name, job_title, phone_mobile, email, role } = req.body;
      if (!first_name && !last_name) return res.status(400).json({ error: "Nom requis" });
      const contactId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error: ce } = await supabaseAdmin.from('contacts').insert({
        id: contactId,
        tenant_id: tenantId,
        first_name: first_name || '',
        last_name: last_name || '',
        company_name: company_name || null,
        job_title: job_title || null,
        phone_mobile: phone_mobile || null,
        phone: phone_mobile || '',
        email: email || '',
        address: '', zip: '', city: '', state: '', country: '',
        candidatures: '', affaires: '', logo: '', ca_amount: 0,
        electronic_signature: '', contact_references: '', tags: '',
        created_at, created_by: req.user.id
      });
      if (ce) throw ce;
      const attendeeId = crypto.randomUUID();
      const { error: ae } = await supabaseAdmin
        .from('meeting_attendees')
        .insert({ id: attendeeId, meeting_id: id, tenant_id: tenantId, contact_id: contactId, role: role || null });
      if (ae) throw ae;
      const contact = { id: contactId, first_name, last_name, company_name, job_title, phone_mobile, phone: phone_mobile || '', email, email_work: null, email_home: null, phone_work: null };
      res.status(201).json({ id: attendeeId, contact_id: contactId, role, contact });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/meetings/:meetingId/attendees/:attendeeId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { attendeeId } = req.params;
      const { role } = req.body;
      const { error } = await supabaseAdmin.from('meeting_attendees').update({ role }).eq('id', attendeeId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/meetings/:meetingId/attendees/:attendeeId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { attendeeId } = req.params;
      const { error } = await supabaseAdmin.from('meeting_attendees').delete().eq('id', attendeeId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── MAF — Déclaration des activités professionnelles ───────────────────────

  // Taux fixes MAF 2025 (‰, hors taxe d'assurance et fonds de solidarité)
  const MAF_TAUX_FIXES: Record<string, number> = {
    violet: 0.3593,
    orange_clair: 1.3047,
    orange_fonce: 1.3047,
    bleu: 3.0065,
  };

  function computeMafAssiette(entry: any, project: any): number {
    const inter = entry.intercalaire ?? 'jaune';
    if (['violet','orange_clair','orange_fonce','bleu','rose','tabac','gris','puc'].includes(inter)) {
      return parseFloat(entry.honoraires_ht ?? 0);
    }
    if (inter === 'vert') {
      const surface = parseFloat(project?.surface_plancher ?? 0);
      const cat = (project?.categorie_projet ?? '').toLowerCase();
      const coutM2 = cat.includes('maison') ? 1714 : 1654;
      const M = coutM2 * surface;
      const T = parseFloat(project?.taux_mission ?? 30) / 100;
      const P = parseFloat(project?.part_interet ?? 100) / 100;
      return M * T * P;
    }
    const A = parseFloat(entry.montant_cumul_fin_annee ?? 0);
    const B = parseFloat(entry.montant_cumul_annee_precedente ?? 0);
    const M = A - B;
    const T = parseFloat(project?.taux_mission ?? 100) / 100;
    const P = parseFloat(project?.part_interet ?? 100) / 100;
    return M * T * P;
  }

  // GET /api/maf/v1/config
  app.get('/api/maf/v1/config', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await supabaseAdmin
        .from('settings')
        .select('maf_enabled,maf_numero_adherent,maf_taux_contrat_permil,maf_declaration_year')
        .eq('tenant_id', tenantId)
        .single();
      res.json(data ?? {});
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/maf/v1/config
  app.put('/api/maf/v1/config', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const allowed = ['maf_enabled','maf_numero_adherent','maf_taux_contrat_permil','maf_declaration_year'];
      const payload: any = {};
      for (const k of allowed) { if (k in req.body) payload[k] = req.body[k]; }
      await supabaseAdmin.from('settings').upsert({ ...payload, tenant_id: tenantId }, { onConflict: 'tenant_id' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/entries?year=2025&intercalaire=jaune
  app.get('/api/maf/v1/entries', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const year = parseInt(req.query.year as string) || 2025;
      let q = supabaseAdmin
        .from('maf_project_data')
        .select('*, project:projects(id,name,client,categorie_projet,surface_plancher,type_projet,taux_mission,part_interet,doc_date,date_fin_reelle,date_depot_pc,num_permis_construire,sismicite,retrait_argiles,bet_structure,etude_sol,mission_bim,type_moa,nature_travaux_maf,budget,adresse_terrain,cp_ville_terrain,type_et_cat,cotraitants)')
        .eq('tenant_id', tenantId)
        .eq('declaration_year', year)
        .order('created_at', { ascending: true });
      if (req.query.intercalaire) q = q.eq('intercalaire', req.query.intercalaire);
      const { data, error } = await q;
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/maf/v1/entries
  app.post('/api/maf/v1/entries', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('maf_project_data')
        .insert({ ...req.body, tenant_id: tenantId })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/maf/v1/entries/:id
  app.put('/api/maf/v1/entries/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin
        .from('maf_project_data')
        .update(req.body)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/maf/v1/entries/:id
  app.delete('/api/maf/v1/entries/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin
        .from('maf_project_data')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/summary?year=2025
  app.get('/api/maf/v1/summary', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const year = parseInt(req.query.year as string) || 2025;

      const [{ data: cfg }, { data: entries }] = await Promise.all([
        supabaseAdmin.from('settings').select('maf_numero_adherent,maf_taux_contrat_permil').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('maf_project_data')
          .select('*, project:projects(id,name,categorie_projet,surface_plancher,taux_mission,part_interet)')
          .eq('tenant_id', tenantId)
          .eq('declaration_year', year),
      ]);

      const tauxContrat = parseFloat((cfg as any)?.maf_taux_contrat_permil ?? 0);
      const intercalaires: Record<string, any> = {};
      let cotisationTotale = 0;

      for (const e of (entries ?? [])) {
        const inter = e.intercalaire;
        const tauxPermil = MAF_TAUX_FIXES[inter] ?? tauxContrat;
        const assiette = computeMafAssiette(e, (e as any).project);
        const cotisation = (assiette * tauxPermil) / 1000;
        cotisationTotale += cotisation;
        if (!intercalaires[inter]) {
          intercalaires[inter] = { entries: [], totalAssiette: 0, cotisationEstimee: 0, tauxPermil };
        }
        intercalaires[inter].entries.push({ ...e, assiette, cotisationEstimee: cotisation });
        intercalaires[inter].totalAssiette += assiette;
        intercalaires[inter].cotisationEstimee += cotisation;
      }

      res.json({
        year,
        numeroAdherent: (cfg as any)?.maf_numero_adherent ?? null,
        intercalaires,
        cotisationTotaleEstimee: cotisationTotale,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/export-pdf?year=2025
  app.get('/api/maf/v1/export-pdf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const year = parseInt(req.query.year as string) || 2025;

      const [{ data: cfg }, { data: settingsData }, { data: entries }] = await Promise.all([
        supabaseAdmin.from('settings').select('maf_numero_adherent,maf_taux_contrat_permil,agency_name').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('settings').select('agency_name').eq('tenant_id', tenantId).single(),
        supabaseAdmin.from('maf_project_data')
          .select('*, project:projects(id,name,categorie_projet,surface_plancher,taux_mission,part_interet,type_et_cat,client)')
          .eq('tenant_id', tenantId)
          .eq('declaration_year', year),
      ]);

      const tauxContrat = parseFloat((cfg as any)?.maf_taux_contrat_permil ?? 0);
      const agencyName = (settingsData as any)?.agency_name ?? 'Cabinet';
      const numAdh = (cfg as any)?.maf_numero_adherent ?? '-';

      // Build PDF using jsPDF
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Cover page
      doc.setFillColor(220, 53, 69);
      doc.rect(0, 0, 210, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Déclaration MAF', 14, 22);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text(`Activités professionnelles ${year} — Cotisation avant le 31 mars ${year + 1}`, 14, 32);

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.text(`Cabinet : ${agencyName}`, 14, 52);
      doc.text(`N° adhérent MAF : ${numAdh}`, 14, 58);
      doc.text(`Année : ${year}`, 14, 64);

      // Summary table
      const summaryRows: any[] = [];
      let totalAssiette = 0;
      let totalCotis = 0;
      const LABELS: Record<string, string> = {
        jaune: 'Missions MOE (intercalaire jaune)',
        vert: 'Projet architectural PC (intercalaire vert)',
        ami: 'Accompagnement Maison Individuelle',
        grand_chantier: 'Grands Chantiers',
        violet: 'Missions sans travaux (intercalaire violet)',
        orange_clair: 'AMO / Relevés (intercalaire orange clair)',
        orange_fonce: 'Conventions spéciales (intercalaire orange foncé)',
        bleu: 'BIM Manager sans MOE (intercalaire bleu)',
        rose: 'Ouvrages non soumis (intercalaire rose)',
        tabac: 'Dossiers autorisation (intercalaire tabac)',
        gris: 'VIR / Vente immeuble (intercalaire gris)',
        puc: 'Police Unique de Chantier',
      };

      const grouped: Record<string, { assiette: number; cotis: number; count: number }> = {};
      for (const e of (entries ?? [])) {
        const inter = e.intercalaire;
        const tauxPermil = MAF_TAUX_FIXES[inter] ?? tauxContrat;
        const assiette = computeMafAssiette(e, (e as any).project);
        const cotis = (assiette * tauxPermil) / 1000;
        if (!grouped[inter]) grouped[inter] = { assiette: 0, cotis: 0, count: 0 };
        grouped[inter].assiette += assiette;
        grouped[inter].cotis += cotis;
        grouped[inter].count += 1;
        totalAssiette += assiette;
        totalCotis += cotis;
      }

      for (const [inter, vals] of Object.entries(grouped)) {
        summaryRows.push([
          LABELS[inter] ?? inter,
          vals.count.toString(),
          vals.assiette.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €',
          (MAF_TAUX_FIXES[inter] ?? tauxContrat).toFixed(4) + ' ‰',
          vals.cotis.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €',
        ]);
      }
      summaryRows.push([
        { content: 'TOTAL', styles: { fontStyle: 'bold' } },
        { content: '', styles: { fontStyle: 'bold' } },
        { content: totalAssiette.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', styles: { fontStyle: 'bold' } },
        { content: '', styles: { fontStyle: 'bold' } },
        { content: totalCotis.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', styles: { fontStyle: 'bold' } },
      ]);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Récapitulatif de la déclaration', 14, 76);

      autoTable(doc, {
        startY: 80,
        head: [['Intercalaire', 'Nb missions', 'Assiette', 'Taux (‰)', 'Cotisation estimée']],
        body: summaryRows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [220, 53, 69], textColor: 255 },
        margin: { left: 14, right: 14 },
      });

      const buf = doc.output('arraybuffer');
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="declaration-maf-${year}.pdf"`);
      res.send(Buffer.from(buf));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/maf/v1/submit — Enterprise only (stub)
  app.post('/api/maf/v1/submit', async (req: any, res: any) => {
    res.status(501).json({
      error: 'not_implemented',
      message: 'L\'automatisation de la déclaration MAF est disponible avec le plan Enterprise. Contactez-nous pour en savoir plus.',
      doc: '/api/maf/v1/spec',
    });
  });

  // GET /api/maf/v1/situations-cumul — Calcul A depuis les situations de travaux
  app.get('/api/maf/v1/situations-cumul', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, year } = req.query as { project_id: string; year: string };
      if (!project_id || !year) return res.status(400).json({ error: 'project_id and year required' });
      const yearNum = parseInt(year);
      const endOfYear = `${yearNum}-12-31`;

      // Toutes les situations validées/payées jusqu'au 31/12 de l'année
      const { data: situations } = await supabaseAdmin
        .from('situations')
        .select('id, numero_situation, date_situation, etat')
        .eq('tenant_id', tenantId)
        .eq('project_id', project_id)
        .in('etat', ['Validée', 'Payée'])
        .lte('date_situation', endOfYear)
        .order('numero_situation', { ascending: true });

      let montantCumulFinAnnee = 0;
      let lastSituation: any = null;

      if (situations?.length) {
        // Agréger les montant_situation de tous les détails
        const ids = situations.map((s: any) => s.id);
        const { data: details } = await supabaseAdmin
          .from('detail_situations')
          .select('montant_situation')
          .eq('tenant_id', tenantId)
          .in('situation_id', ids);
        montantCumulFinAnnee = details?.reduce((sum: number, d: any) => sum + (Number(d.montant_situation) || 0), 0) ?? 0;
        lastSituation = situations[situations.length - 1];
      }

      // B = montant_cumul_fin_annee déclaré pour l'année N-1 sur ce projet (intercalaires avec travaux)
      const { data: prevEntry } = await supabaseAdmin
        .from('maf_project_data')
        .select('montant_cumul_fin_annee')
        .eq('tenant_id', tenantId)
        .eq('project_id', project_id)
        .eq('declaration_year', yearNum - 1)
        .in('intercalaire', ['jaune', 'ami', 'grand_chantier'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const montantCumulAnneePrecedente = Number(prevEntry?.montant_cumul_fin_annee ?? 0);

      res.json({
        montantCumulFinAnnee,
        montantCumulAnneePrecedente,
        situationCount: situations?.length ?? 0,
        source: lastSituation ? {
          situationId: lastSituation.id,
          situationNumero: lastSituation.numero_situation,
          situationDate: lastSituation.date_situation,
        } : null,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/maf/v1/entries/:id/statut — Changer le statut (brouillon ↔ declaree)
  app.patch('/api/maf/v1/entries/:id/statut', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { statut } = req.body as { statut: 'brouillon' | 'declaree' };
      if (!['brouillon', 'declaree'].includes(statut)) return res.status(400).json({ error: 'statut invalide' });
      const { data, error } = await supabaseAdmin
        .from('maf_project_data')
        .update({ statut, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/suivi — Toutes les années pour traçabilité pluriannuelle
  app.get('/api/maf/v1/suivi', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('maf_project_data')
        .select('*, project:projects(id, name, client, taux_mission, part_interet, categorie_projet, surface_plancher)')
        .eq('tenant_id', tenantId)
        .order('declaration_year', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      res.json(data ?? []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/maf/v1/spec — OpenAPI spec
  app.get('/api/maf/v1/spec', (_req: any, res: any) => {
    res.json({
      openapi: '3.0.0',
      info: { title: 'ArchiOffice MAF API', version: '1.0.0' },
      servers: [{ url: '/api/maf/v1' }],
      paths: {
        '/config': { get: {}, put: {} },
        '/entries': { get: {}, post: {} },
        '/entries/{id}': { put: {}, delete: {} },
        '/summary': { get: {} },
        '/export-pdf': { get: {} },
        '/submit': { post: { description: 'Enterprise only — soumet la déclaration à maf.fr' } },
      },
    });
  });

  // Must be registered after all routes but before the SPA fallback below —
  // catches anything that reaches Express's default error handling (routes
  // that call next(err), or throw outside a try/catch) that the per-route
  // catch blocks above didn't already report via captureConsoleIntegration.
  Sentry.setupExpressErrorHandler(app);

  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  // Vite middleware for development (dynamic import so vite devDep is not needed in production)
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
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
    if (process.env.OFFLINE_MODE === 'true') {
      ensureStorageBuckets();
    }
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  Sentry.captureException(err);
  process.exit(1);
});
