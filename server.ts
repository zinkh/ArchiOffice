import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { captureWithContext } from "./server/sentryContext";
import { registerProjectTemplateRoutes } from "./server/routes/projectTemplates";
import { registerActDataRoutes } from "./server/routes/actData";
import { registerDetDataRoutes } from "./server/routes/detData";
import { registerDpgfRoutes } from "./server/routes/dpgf";
import { registerSituationRoutes } from "./server/routes/situations";
import { registerCctpRoutes } from "./server/routes/cctps";
import { registerCustomReferenceRoutes } from "./server/routes/customReferences";
import { registerProjectMemberRoutes } from "./server/routes/projectMembers";
import { registerProjectPhaseHistoryRoutes } from "./server/routes/projectPhaseHistory";
import { registerGlobalSearchRoutes } from "./server/routes/globalSearch";
import { registerObservationRoutes } from "./server/routes/observations";
import { registerMeetingRoutes } from "./server/routes/meetings";
import { registerMeetingAttendeeRoutes } from "./server/routes/meetingAttendees";
import { registerDocumentTemplateRoutes } from "./server/routes/documentTemplates";
import { registerContratsMoeRoutes } from "./server/routes/contratsMoe";
import { registerNotesHonorairesRoutes } from "./server/routes/notesHonoraires";
import { registerProfileRoutes } from "./server/routes/profile";
import { registerActivityFeedRoutes } from "./server/routes/activityFeed";
import { registerMessagingRoutes } from "./server/routes/messaging";
import { registerContactSyncRoutes } from "./server/routes/contactSync";
import { registerGeoProxyRoutes } from "./server/routes/geoProxy";
import { registerMafRoutes } from "./server/routes/maf";
import { registerTimeTrackingRoutes } from "./server/routes/timeTracking";
import { registerLeaveRoutes } from "./server/routes/leave";
import { registerTenderRoutes } from "./server/routes/tenders";
import { registerTenderRssRoutes } from "./server/routes/tenderRss";
import { registerMilestoneRoutes } from "./server/routes/milestones";
import { registerSpecificationRoutes } from "./server/routes/specifications";
import { registerContactRoutes } from "./server/routes/contacts";
import { registerSuperAdminRoutes } from "./server/routes/superAdmin";
import { registerMarchesEntreprisesRoutes } from "./server/routes/marchesEntreprises";
import { registerBillingRoutes } from "./server/routes/billing";
import { registerZohoInvoiceRoutes } from "./server/routes/zohoInvoice";
import { registerZohoBooksRoutes } from "./server/routes/zohoBooks";
import { registerRagicRoutes } from "./server/routes/ragic";
import { registerOdooRoutes } from "./server/routes/odoo";
import { registerSuperpdpRoutes } from "./server/routes/superpdp";
import { registerChorusProRoutes } from "./server/routes/chorusPro";
import { registerRegistrationRoutes } from "./server/routes/registration";
import { registerAgencySetupRoutes } from "./server/routes/agencySetup";
import { registerTeamRoutes } from "./server/routes/team";
import { registerProposalRoutes } from "./server/routes/proposals";
import { registerInvoiceRoutes } from "./server/routes/invoices";
import { registerOrdresDeServiceRoutes } from "./server/routes/ordresDeService";
import { registerVisaRoutes } from "./server/routes/visas";
import { registerReceptionRoutes } from "./server/routes/receptions";
import { registerReserveRoutes } from "./server/routes/reserves";
import { registerGpaReserveRoutes } from "./server/routes/gpaReserves";
import { registerPermitRoutes } from "./server/routes/permits";
import { registerRfiRoutes } from "./server/routes/rfis";
import { registerProjectRoutes } from "./server/routes/projects";
import { registerPlanRoutes } from "./server/routes/plans";
import { registerDocumentRoutes } from "./server/routes/documents";
import { registerTaskRoutes } from "./server/routes/tasks";
import { registerSendEmailRoutes } from "./server/routes/sendEmail";
import { registerSiteReportRoutes } from "./server/routes/siteReports";
import { registerSettingsRoutes } from "./server/routes/settings";
import { registerUploadRoutes } from "./server/routes/uploads";
import { registerLotRoutes } from "./server/routes/lots";
import { registerAiSuggestionRoutes } from "./server/routes/aiSuggestions";
import { registerCopilotSuggestionRoutes } from "./server/routes/copilotSuggestions";
import { getNextDocNumber as getNextDocNumberImpl } from "./server/getNextDocNumber";
import { getNextAffaireInvoiceNumber as getNextAffaireInvoiceNumberImpl } from "./server/getNextAffaireInvoiceNumber";
import { sanitizeFilename } from "./server/sanitizeFilename";
import { fetchWithTimeout } from "./server/fetchWithTimeout";
import multer from "multer";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/node";
import { startTenderRssPolling } from "./server/tenderRssPoller";

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
        console.error("[server.ts:948]", e);
        // Column likely already exists
      }
    }
  }

  try {
    db.prepare(`ALTER TABLE invoices ADD COLUMN advancement_pct NUMERIC DEFAULT 0`).run();
  } catch (e) {
    console.error("[server.ts:956]", e);
    // Column likely already exists
  }

  try {
    db.prepare(`ALTER TABLE specifications ADD COLUMN is_template INTEGER DEFAULT 0`).run();
  } catch (e) {
    console.error("[server.ts:962]", e);
    // Column likely already exists
  }

  // Migrate OS type column with proper default
  try {
    db.prepare(`ALTER TABLE ordres_de_service ADD COLUMN type TEXT DEFAULT 'travaux'`).run();
  } catch (e) {
    console.error("[server.ts:969]", e);
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

// Builds and fully configures the Express app (all middleware + all ~340
// routes) without binding a port — the production entry point (startServer(),
// below) adds the .listen() call. Exported so Supertest can drive the app
// in-process; see tests/testServer.ts.
export async function createApp() {
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

  async function getSystemRole(tenantId: string, userId: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from('profiles').select('system_role').eq('id', userId).eq('tenant_id', tenantId).single();
    return (data as any)?.system_role ?? null;
  }

  // Centralized route guard for admin-only endpoints — checks the caller's
  // system_role in `profiles` (never a client-supplied value: a route that
  // trusted e.g. a request header for this was the exact bug this middleware
  // was introduced to close, see DELETE /api/projects/:id). Mount it as
  // middleware: app.delete("/path", requireRole('admin'), handler).
  function requireRole(...roles: string[]) {
    return async (req: any, res: any, next: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        const role = await getSystemRole(tenantId, req.user.id);
        if (!role || !roles.includes(role)) {
          return res.status(403).json({ error: `Réservé aux rôles : ${roles.join(', ')}` });
        }
        req.tenantId = tenantId;
        next();
      } catch (e: any) {
        console.error("[server.ts:1270]", e);
        res.status(e.status || 500).json({ error: e.message || 'Failed to verify role' });
      }
    };
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
    for (const bucket of ['documents', 'plans', 'cv', 'message-attachments', 'feed-attachments']) {
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
    // Zoho's OAuth redirect back to us is a bare browser navigation — it
    // can't carry our app's JWT. These recover the tenant from a one-time
    // state nonce instead (server/oauthState.ts), not from req.user.
    "/api/zoho/callback", "/api/zoho-books/callback",
    // Called by Ragic itself (external, no JWT) — authenticated via a
    // `secret` query param checked against the tenant's own ragic_api_key
    // inside the handler, not via our session auth. Was missing here, so
    // the auth middleware 401'd it before that check ever ran.
    "/api/ragic/webhook",
  ];

  app.use("/api", async (req: any, res: any, next: any) => {
    // Strip the query string before matching: req.originalUrl includes it
    // (req.path, the alternative, is relative to this middleware's "/api"
    // mount point and would silently break every other entry in the list
    // instead). The Zoho OAuth callbacks below always arrive as e.g.
    // /api/zoho/callback?code=...&state=..., so matching the raw
    // originalUrl could never succeed for them.
    const pathOnly = req.originalUrl.split("?")[0];
    if (AUTH_EXEMPT.some(p => pathOnly === p || pathOnly.startsWith(p + "/"))) {
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

  async function requireTenantAdmin(userId: string): Promise<string> {
    const tenantId = await getTenantId(userId);
    if ((await getSystemRole(tenantId, userId)) !== 'admin') {
      const err: any = new Error("Réservé aux administrateurs de l'agence");
      err.status = 403;
      throw err;
    }
    return tenantId;
  }

  async function isAdmin(tenantId: string, userId: string): Promise<boolean> {
    return (await getSystemRole(tenantId, userId)) === 'admin';
  }

  // Allows: the person themselves, a tenant admin, or the target's direct manager (profiles.manager_id).
  async function requireManagerOf(tenantId: string, targetUserId: string, actingUserId: string): Promise<void> {
    if (targetUserId === actingUserId) return;
    const { data: acting } = await supabaseAdmin.from('profiles').select('system_role').eq('id', actingUserId).eq('tenant_id', tenantId).single();
    if (acting?.system_role === 'admin') return;
    const { data: target } = await supabaseAdmin.from('profiles').select('manager_id').eq('id', targetUserId).eq('tenant_id', tenantId).single();
    if (target?.manager_id === actingUserId) return;
    const err: any = new Error("Réservé au manager de cette personne ou à un administrateur");
    err.status = 403;
    throw err;
  }

  // Resolves the set of profile ids that report to `managerId` (direct reports only).
  // If `includeAllForAdmin` is true and the manager is a tenant admin, returns every profile in the tenant instead.
  async function resolveReportIds(tenantId: string, managerId: string, includeAllForAdmin: boolean): Promise<string[]> {
    if (includeAllForAdmin) {
      const { data: acting } = await supabaseAdmin.from('profiles').select('system_role').eq('id', managerId).eq('tenant_id', tenantId).single();
      if (acting?.system_role === 'admin') {
        const { data: all } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId);
        return (all || []).map((p: any) => p.id);
      }
    }
    const { data: reports } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId).eq('manager_id', managerId);
    return (reports || []).map((p: any) => p.id);
  }

  function businessDaysBetween(startDateStr: string, endDateStr: string): number {
    let count = 0;
    let d = new Date(startDateStr + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T00:00:00Z');
    while (d <= end) {
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return count;
  }

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

  // ── End Activity Feed ───────────────────────────────────────────────────────

  // Auto-numbering (PREFIX-YEAR-SEQ) shared by notesHonoraires.ts,
  // proposals.ts and invoices.ts — bound to supabaseAdmin here since
  // server/getNextDocNumber.ts is a standalone module, not a createApp() closure.
  const getNextDocNumber = (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) =>
    getNextDocNumberImpl(supabaseAdmin, tenantId, settingCol, countTable, defaultPrefix);

  // Per-affaire business-reference numbering for acompte invoices — see
  // server/getNextAffaireInvoiceNumber.ts. Bound to supabaseAdmin the same
  // way as getNextDocNumber above.
  const getNextAffaireInvoiceNumber = (tenantId: string, projectId: string) =>
    getNextAffaireInvoiceNumberImpl(supabaseAdmin, tenantId, projectId);

  // Phase 7 pilot: Project Templates / ACT Data / DET Data now live in
  // server/routes/*.ts — see those files for why they were picked first
  // (small, self-contained, low traffic) and server/tenantScopedFrom.ts for
  // the shared data-access helper they use instead of a hand-written
  // `.eq('tenant_id', tenantId)` on each query.
  registerProjectTemplateRoutes(app, { supabaseAdmin, getTenantId });
  registerActDataRoutes(app, { supabaseAdmin, getTenantId });
  registerDetDataRoutes(app, { supabaseAdmin, getTenantId });
  registerDpgfRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSituationRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerCctpRoutes(app, { supabaseAdmin, getTenantId });
  registerCustomReferenceRoutes(app, { supabaseAdmin, getTenantId });
  registerProjectMemberRoutes(app, { supabaseAdmin, getTenantId });
  registerProjectPhaseHistoryRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerGlobalSearchRoutes(app, { supabaseAdmin, getTenantId });
  registerObservationRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerMeetingRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, uploadToStorage, deleteFromStorage, upload });
  registerMeetingAttendeeRoutes(app, { supabaseAdmin, getTenantId });
  registerDocumentTemplateRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerContratsMoeRoutes(app, { supabaseAdmin, getTenantId, captureWithContext });
  registerNotesHonorairesRoutes(app, { supabaseAdmin, getTenantId, captureWithContext, getNextDocNumber });
  registerProfileRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage, upload });
  registerActivityFeedRoutes(app, { supabaseAdmin, getTenantId, getUserName, uploadToStorage, captureWithContext, upload });
  registerMessagingRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, upload });
  registerContactSyncRoutes(app, { supabaseAdmin, getTenantId });
  registerGeoProxyRoutes(app);
  registerMafRoutes(app, { supabaseAdmin, getTenantId });
  registerTimeTrackingRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, requireManagerOf, resolveReportIds, isAdmin, requireTenantAdmin });
  registerLeaveRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, requireManagerOf, resolveReportIds, isAdmin, requireTenantAdmin, businessDaysBetween });
  registerTenderRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext });
  registerTenderRssRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerMilestoneRoutes(app, { supabaseAdmin, getTenantId });
  registerSpecificationRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerContactRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSuperAdminRoutes(app, { supabaseAdmin });
  registerMarchesEntreprisesRoutes(app, { supabaseAdmin, getTenantId });
  registerBillingRoutes(app, { supabaseAdmin, getTenantId, PLAN_LIMITS, PLAN_AI_MONTHLY_CREDIT_CENTS, AI_CREDIT_PACKS });
  registerZohoInvoiceRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerZohoBooksRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerRagicRoutes(app, { supabaseAdmin, getTenantId });
  registerOdooRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSuperpdpRoutes(app, { supabaseAdmin, getTenantId });
  registerChorusProRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerRegistrationRoutes(app, { supabaseAdmin });
  registerAgencySetupRoutes(app, { supabaseAdmin });
  registerTeamRoutes(app, { supabaseAdmin, getTenantId, requireTenantAdmin, checkQuota });
  registerProposalRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext, getNextDocNumber, upload });
  registerInvoiceRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext, getNextDocNumber, getNextAffaireInvoiceNumber });
  registerOrdresDeServiceRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerVisaRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, upload });
  registerReceptionRoutes(app, { supabaseAdmin, getTenantId });
  registerReserveRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerGpaReserveRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerPermitRoutes(app, { supabaseAdmin, getTenantId });
  registerRfiRoutes(app, { supabaseAdmin, getTenantId });
  registerProjectRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, captureWithContext, requireRole });
  registerPlanRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage, upload });
  registerDocumentRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, uploadToStorage, deleteFromStorage, upload });
  registerTaskRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSendEmailRoutes(app, { supabaseAdmin, getTenantId });
  registerSiteReportRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext });
  registerSettingsRoutes(app, { supabaseAdmin, getTenantId, requireTenantAdmin });
  registerUploadRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, upload });
  registerLotRoutes(app, { supabaseAdmin, getTenantId });
  registerAiSuggestionRoutes(app, { supabaseAdmin, getTenantId, getTenantPlan, maybeRefreshMonthlyCredits, deductAiCredit });
  registerCopilotSuggestionRoutes(app, { supabaseAdmin, getTenantId });

  // Phase 7: DPGF (items + parents) and Situations (+ detail lines) now live
  // in server/routes/dpgf.ts and server/routes/situations.ts — registered
  // above alongside the other extracted domains.

  // Phase 7: CCTPs update/delete now live in server/routes/cctps.ts.

  // Phase 7: Custom References now live in server/routes/customReferences.ts.

  // Phase 7: Project Members, Project Phase History, and Global Search now
  // live in server/routes/projectMembers.ts, projectPhaseHistory.ts, and
  // globalSearch.ts.

  // ── Agents IA ─────────────────────────────────────────────────────────────
  // Logique métier dans @zinkh/archioffice-agents (package privé, licence propriétaire)
  const { registerAgentRoutes } = await import('@zinkh/archioffice-agents/server');
  registerAgentRoutes(app, supabaseAdmin, getTenantId, getTenantPlan, {
    deductAiCredit,
    maybeRefreshMonthlyCredits,
    PLAN_AI_MONTHLY_CREDIT_CENTS,
    baseUrl: `http://127.0.0.1:${PORT}`,
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
        console.error("[server.ts:10601]", e);
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

  return { app, supabaseAdmin, ensureStorageBuckets, PORT };
}

// Thin wrapper kept separate from createApp() so Supertest (and anything else
// that just needs a handle on `app`) can import createApp() without binding a
// real port — see tests/testServer.ts. Production startup is unchanged: this
// is still the only thing invoked at module load.
async function startServer() {
  const { app, supabaseAdmin, ensureStorageBuckets, PORT } = await createApp();
  // Start listening after all middleware is set up
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (process.env.OFFLINE_MODE === 'true') {
      ensureStorageBuckets();
    }
    // Veille RSS des appels d'offres — sondage périodique (server/tenderRssPoller.ts).
    // Démarré ici (pas plus tôt) car en mode offline, supabaseAdmin boucle sur le
    // shim REST de ce même serveur, qui n'accepte les requêtes qu'une fois à l'écoute.
    startTenderRssPolling(supabaseAdmin);
  });
}

// Vitest sets process.env.VITEST — skip the real listen() when this module is
// merely imported for its createApp() export (Supertest drives the app
// in-process instead; see tests/testServer.ts). Production entry point is
// unaffected: nothing outside a Vitest run ever sets this variable.
if (!process.env.VITEST) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    Sentry.captureException(err);
    process.exit(1);
  });
}
