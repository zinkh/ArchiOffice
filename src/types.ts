export type DocumentPhase = 'ESQ' | 'APS' | 'APD' | 'PC' | 'PRO' | 'DCE' | 'ACT' | 'VISA' | 'DET' | 'AOR' | 'Général';

export interface ProjectPhaseHistoryEntry {
  id: string;
  project_id: string;
  phase: DocumentPhase;
  entered_at: string;
  exited_at: string | null;
}

export interface Document {
  id: string;
  project_id: string;
  name: string;
  category: 'Architectural Drawing' | 'Contract' | 'Report' | 'Other' | 'Template';
  phase?: DocumentPhase;
  version: number;
  file_url: string;
  uploaded_by: string; // TeamMember ID
  uploaded_at: string;
  description?: string;
  indice?: string;           // 'A', 'B', 'C'...
  doc_statut?: 'en_cours' | 'approuve' | 'perime';
  emetteur?: string;
  approbateur?: string;
  date_approbation?: string;
  doc_type?: string;
  contact_id?: string;
  contact_name?: string;
  validation_status?: 'pending' | 'approved' | 'rejected' | 'commented';
  validation_comments?: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  file_url: string;
  uploaded_by: string;
  uploaded_at: string;
  description?: string;
}

export interface DocumentDiffusion {
  id: string;
  document_id: string;
  contact_name: string;
  contact_email?: string;
  sent_at: string;
  acknowledged_at?: string;
  notes?: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  // Default values
  default_status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  default_budget: number;
  default_category?: string;
  default_lots_list?: ProjectLot[];
  default_milestones?: { title: string; due_date_offset_days: number }[];
  default_description: string;
}

export interface DocumentTemplateVariable {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'number';
  required?: boolean;
  default_value?: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  category: 'Contrat MOE' | 'CCTP' | 'DPGF' | 'Candidature' | 'Courrier' | 'OS' | 'Autre';
  description?: string;
  content: string;
  variables: DocumentTemplateVariable[];
  is_seeded: boolean;
  editable: boolean;
  is_default: boolean;
  source_template_id?: string | null;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  user_id: string;
  project_id?: string | null;
  entry_date: string;
  start_time: string;
  end_time?: string | null;
  description?: string;
  source: 'clock' | 'manual';
}

export interface TimeWeeklySummary {
  total_hours: number;
  by_project: { project_id: string | null; hours: number }[];
  by_day: { date: string; hours: number }[];
}

export interface TimeTeamSummaryEntry {
  user_id: string;
  name: string;
  total_hours: number;
}

export interface TimeAdminMatrix {
  employees: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  cells: { user_id: string; project_id: string | null; hours: number }[];
}

export interface TeamScheduleEmployee {
  id: string;
  name: string;
  job_title?: string;
  department?: string;
}

export interface TeamSchedule {
  employees: TeamScheduleEmployee[];
  entries: TimeEntry[];
  leaves: LeaveRequest[];
  projects: { id: string; name: string }[];
}

export interface TimeMonthlySummaryEntry {
  user_id: string;
  name: string;
  total_hours: number;
}

export type LeaveType = 'conges_payes' | 'rtt' | 'maladie' | 'sans_solde' | 'exceptionnel';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveExceptionnelMotif =
  | 'naissance' | 'mariage_salarie' | 'mariage_enfant' | 'journee_citoyen'
  | 'paternite' | 'deces_conjoint_enfant' | 'deces_parent' | 'deces_autre_famille';

export interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  motif?: LeaveExceptionnelMotif | string;
  start_date: string;
  end_date: string;
  business_days: number;
  reason?: string;
  status: LeaveStatus;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  created_at: string;
}

export interface LeaveBalance {
  user_id: string;
  year: number;
  leave_type: 'conges_payes' | 'rtt';
  allocated_days: number;
  used_days: number;
  remaining_days: number;
}

export interface LeaveBalanceAllEntry {
  user_id: string;
  name: string;
  year: number;
  balances: { leave_type: 'conges_payes' | 'rtt'; allocated_days: number; used_days: number; remaining_days: number }[];
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  start_date: string;
  end_date: string;
  progress: number; // 0-100
  dependencies: string[]; // Array of task IDs
  status?: 'todo' | 'in_progress' | 'review' | 'done';
  due_date?: string;
  completed?: boolean;
}

export interface ProjectCotraitant {
  id: string;
  project_id: string;
  specialty: string;
  contact_id?: string;
  contact_name?: string;
}

export interface ProjectStakeholder {
  id: string;
  project_id: string;
  name: string;
  role: string;
  contact_id?: string;
}

export interface ProjectLot {
  id: string;
  project_id: string;
  lot_number: string;
  lot_title: string;
  contact_id?: string;
  contact_name?: string;
  market_number?: string;
  base_amount?: number;
  options_amount?: number;
  amendments_amount?: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  client_id?: string;
  status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  budget: number;
  category?: string;
  start_date: string;
  end_date: string;
  description: string;
  image_url?: string;
  project_code?: string;
  address?: string;
  // Factur-X / EN 16931 fields
  client_siret?: string;
  client_vat_number?: string;
  client_email?: string;
  is_public_client?: boolean;
  is_complete_mission?: boolean;
  is_chantier?: boolean;
  etudes_notes?: string;
  chantier_notes?: string;
  surface?: number;
  construction_cost?: number;
  remuneration?: number;
  progression?: number;
  project_manager?: string;
  cotraitants?: string;
  cotraitants_list?: ProjectCotraitant[];
  stakeholders_list?: ProjectStakeholder[];
  lots_list?: ProjectLot[];
  categories_list?: ProjectCategory[];
  external_intervenants?: string;
  entreprises?: string;

  // Fields from Proposal
  reference?: string;
  projet_detail?: string;
  is_entreprise?: boolean;
  nom_societe?: string;
  rcs?: string;
  representant?: string;
  qualite?: string;
  adresse_client?: string;
  cp_client?: string;
  ville_client?: string;
  telephone?: string;
  portable?: string;
  email_client?: string;
  adresse_terrain?: string;
  cp_ville_terrain?: string;
  ban_id_terrain?: string;
  city_code_terrain?: string;
  ref_cadastrale?: string;
  zone_plu?: string;
  surface_parcelle?: string;
  nom_etablissement?: string;
  avant_trav?: string;
  apres_trav?: string;
  type_et_cat?: string;
  type_projet?: string;
  categorie_projet?: string;
  surface_plancher?: string;
  surface_plancher_ext?: string;
  surface_erp?: string;
  surface_ert?: string;
  effectif_public?: string;
  effectif_personnel?: string;
  ind?: string;
  date_modification?: string;
  site_postcode?: string;
  site_city?: string;
  // MAF fields
  doc_date?: string;
  date_fin_reelle?: string;
  date_depot_pc?: string;
  num_permis_construire?: string;
  sismicite?: string;
  retrait_argiles?: string;
  bet_structure?: boolean;
  etude_sol?: boolean;
  mission_bim?: boolean;
  type_moa?: string;
  nature_travaux_maf?: string;
  maf_intercalaire?: MafIntercalaire;
  taux_mission?: number;
  part_interet?: number;

  // Context fields used by the ProjectDetail overview
  secteur_abf?: string;
  programme?: string;
}

export interface OrdreDeService {
  id: string;
  project_id: string;
  os_number: string;
  march_number?: string;
  title: string;
  date: string;
  description?: string;
  lot?: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  type?: 'travaux' | 'contrat_moe';
  maitrise_oeuvre_adresse?: string;
  entreprise?: string;
  origine_demande?: 'maitrise_ouvrage' | 'maitrise_oeuvre' | 'aleas' | 'autres';
  montant_marche_ht?: number;
  objet?: string;
  date_fourniture?: string;
  article_ccap?: string;
  incidences_delais_type?: 'non' | 'oui';
  incidences_delais_details?: string;
  incidences_couts_type?: 'non' | 'oui';
  montant_devis_presente?: number;
  montant_devis_accepte?: number;
  date_signature?: string;
  date_emission?: string;
  date_ar?: string;
  date_execution?: string;
  emetteur_os?: string;
  destinataire_os?: string;
  notes_ar?: string;
  delai_execution?: number;
  delai_unit?: string;
}

export interface Visa {
  id: string;
  project_id: string;
  title: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected' | 'commented';
  comments?: string;
  document_url?: string;
  lot_id?: string;
}

export interface Reception {
  id: string;
  project_id: string;
  date: string;
  type: 'provisoire' | 'definitive';
  has_reserves: boolean;
  reserves_count?: number;
  document_url?: string;
  reference_pv?: string;
  lieu?: string;
  signataires?: string; // JSON [{nom, role}]
  observations?: string;
  date_limite_levee?: string;
  pv_valide?: boolean;
}

export interface Reserve {
  id: string;
  project_id: string;
  reception_id?: string;
  title: string;
  batiment: string;
  local: string;
  status: 'A faire' | 'En cours' | 'Levée' | 'Refusée par l\'entreprise' | 'Quitus Transmis' | 'Levée refusée par le MOE';
  lots: string; // JSON stringified array
  entreprises: string; // JSON stringified array
  created_at: string;
  due_date: string;
  plan_id?: string;
  x?: number;
  y?: number;
  number?: number;
}

export interface Permit {
  id: string;
  tenant_id?: string;
  project_id: string;
  type: 'PC' | 'DP' | 'AT';
  reference?: string;
  submission_date?: string;
  decision_date?: string;
  status: 'en_instruction' | 'accorde' | 'refuse' | 'recours';
  notes?: string;
  created_at?: string;
}

export interface Rfi {
  id: string;
  tenant_id?: string;
  project_id: string;
  question: string;
  asked_by?: string;
  asked_date?: string;
  due_date?: string;
  status: 'en_attente' | 'repondu';
  answer?: string;
  answered_date?: string;
  created_at?: string;
}

export interface GpaReserve {
  id: string;
  project_id: string;
  reception_id?: string;
  title: string;
  batiment: string;
  local: string;
  status: 'A faire' | 'En cours' | 'Levée' | 'Refusée par l\'entreprise' | 'Quitus Transmis' | 'Levée refusée par le MOE';
  lots: string; // JSON stringified array
  entreprises: string; // JSON stringified array
  created_at: string;
  due_date: string;
  plan_id?: string;
  x?: number;
  y?: number;
  number?: number;
}

export interface Plan {
  id: string;
  project_id: string;
  name: string;
  file_url: string;
  uploaded_at: string;
  index: string;
  version: number;
  parent_id?: string;
  category?: 'PRO' | 'AOR';
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
  avatar?: string;
  system_role: 'admin' | 'manager' | 'pm' | 'user';
  manager_id?: string | null;
  senderOption?: 'agency' | 'personal';
  defaultEmailTemplate?: string;
  phone?: string;
  address?: string;
  jobTitle?: string;
  department?: string;
  tenantId?: string | null;
  // Platform back-office access — orthogonal to system_role (see
  // server/superAdminAuth.ts). Only ever set on the current user's own
  // profile via GET /api/me, never on other TeamMember rows.
  isSuperAdmin?: boolean;
}

export interface Milestone {
  id: string;
  project_id?: string;
  proposal_id?: string;
  tender_id?: string;
  title: string;
  due_date: string;
  completed: boolean;
  duration_days?: number;
  dependencies?: string[]; // Array of milestone IDs
}

export interface TenderSpecialty {
  id: string;
  tender_id: string;
  specialty_name: string;
  contact_id?: string;
  contact_name?: string;
}

export interface Tender {
  id: string;
  title: string;
  client: string;
  submission_deadline: string;
  status: 'Draft' | 'Submitted' | 'Won' | 'Lost';
  value: number;
  notes: string;
  mandataire_id?: string;
  mandataire_name?: string;
  type?: string;
  surface?: number;
  construction_cost?: number;
  honoraires_percent?: number;
  complexity_rate?: number;
  base_fee_percent?: number;
  miqcp_assessment?: string; // JSON string — MiqcpAssessment (Guide MIQCP complexity wizard)
  mandatory_visit?: boolean;
  visit_date?: string;
  withdrawal_deadline?: string;
  specialties_list?: TenderSpecialty[];
  milestones_list?: Milestone[];
  archived?: boolean;
  ville_execution?: string;
}

export type TenderSourceType = 'rss' | 'boamp';
export type BoampTypeMarche = 'TRAVAUX' | 'SERVICES' | 'FOURNITURES';

// Critères propres au connecteur BOAMP (server/tenderBoampConnector.ts).
export interface BoampSourceConfig {
  departements: string[];
  types_marche: BoampTypeMarche[];
  avis_initiaux_seulement: boolean;
  jours_recents: number;
}

export interface TenderRssSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  include_keywords: string[];
  exclude_keywords: string[];
  // 'rss' (défaut) ou 'boamp' — l'API BOAMP n'est proposée que si le
  // connecteur est activé dans Paramètres > Marketplace.
  source_type?: TenderSourceType;
  boamp_config?: Partial<BoampSourceConfig> | null;
  last_polled_at?: string | null;
  last_error?: string | null;
}

export interface TenderRssMatch {
  id: string;
  source_id: string;
  source_name?: string | null;
  title: string;
  link?: string | null;
  description?: string | null;
  pub_date?: string | null;
  // 'watched' = surveillée par l'utilisateur (onglet "Annonces sélectionnées"),
  // seul état à partir duquel la conversion en appel d'offres est proposée.
  status: 'new' | 'read' | 'dismissed' | 'watched' | 'converted';
  tender_id?: string | null;
  created_at?: string;
  // Best-effort BOAMP-style fields extracted from the description at ingest
  // time (server/tenderFieldExtractor.ts) — absent when nothing was found.
  ville_execution?: string | null;
  pouvoir_adjudicateur?: string | null;
  montant_travaux?: number | null;
  date_limite_reponse?: string | null;
}

export interface Specification {
  id: string;
  project_id: string;
  title: string;
  content: string; // JSON string
  last_updated: string;
  is_template?: boolean;
}

export interface SpecSection {
  id: string;
  title: string;
  items: SpecItem[];
}

export interface Contact {
  id: string;
  // Name fields
  prefix?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  suffix?: string;
  nickname?: string;
  
  // Organization fields
  company_name?: string;
  job_title?: string;
  department?: string;
  
  // Email fields
  email_work?: string;
  email_home?: string;
  email_other?: string;
  email: string; // Primary email for backward compatibility/display
  
  // Phone fields
  phone_mobile?: string;
  phone_work?: string;
  phone_home?: string;
  phone_main?: string;
  phone_fax_work?: string;
  phone_fax_home?: string;
  phone_pager?: string;
  phone_other?: string;
  phone: string; // Primary phone for backward compatibility/display
  
  // Address fields (Work)
  address_work_street?: string;
  address_work_city?: string;
  address_work_state?: string;
  address_work_zip?: string;
  address_work_country?: string;
  
  // Address fields (Home)
  address_home_street?: string;
  address_home_city?: string;
  address_home_state?: string;
  address_home_zip?: string;
  address_home_country?: string;

  // Legacy/App specific fields
  address: string; // Display address
  zip: string;
  city: string;
  state: string;
  country: string;
  
  siret?: string;
  vat_number?: string;
  candidatures: string;
  affaires: string;
  logo: string;
  ca_amount: number;
  electronic_signature: string;
  contact_references: string;
  tags: string;
  category?: string;
  notes?: string;
  birthday?: string;
  website?: string;
  created_at: string;
  created_by: string;
}

export interface ContactCategory {
  id: string;
  name: string;
}

export interface ProjectCategory {
  id: string;
  name: string;
  color?: string;
}

export interface SpecItem {
  id: string;
  code: string;
  description: string;
  material: string;
  notes: string;
}

export interface ProposalSpecialty {
  id: string;
  proposal_id: string;
  specialty_name: string;
  contact_id?: string;
  contact_name?: string;
}

export interface Proposal {
  id: string;
  title: string;
  client_id: string;
  client_name?: string;
  amount: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
  description: string;
  created_at: string;
  
  // New parameters
  reference?: string;
  projet_detail?: string;
  is_entreprise?: boolean;
  nom_societe?: string;
  rcs?: string;
  representant?: string;
  qualite?: string;
  adresse_client?: string;
  cp_client?: string;
  ville_client?: string;
  telephone?: string;
  portable?: string;
  email_client?: string;
  adresse_terrain?: string;
  cp_ville_terrain?: string;
  ban_id_terrain?: string;
  city_code_terrain?: string;
  ref_cadastrale?: string;
  zone_plu?: string;
  surface_parcelle?: string;
  nom_etablissement?: string;
  avant_trav?: string;
  apres_trav?: string;
  type_et_cat?: string;
  type_projet?: string;
  categorie_projet?: string;
  surface_plancher?: string;
  surface_plancher_ext?: string;
  surface_erp?: string;
  surface_ert?: string;
  effectif_public?: string;
  effectif_personnel?: string;
  ind?: string;
  date_modification?: string;
  // MAF — type de mission (circulaire d'activités)
  maf_intercalaire?: MafIntercalaire;
  taux_mission?: number;
  part_interet?: number;
  specialties_list?: ProposalSpecialty[];
  fee_distribution?: string; // JSON string for reactgrid data
  miqcp_assessment?: string; // JSON string — MiqcpAssessment (Guide MIQCP complexity wizard)

  // New XML fields
  project_code?: string;
  project_number?: string;
  project_status?: string;
  keywords?: string;
  notes?: string;

  site_name?: string;
  site_description?: string;
  site_id?: string;
  site_address_1?: string;
  site_address_2?: string;
  site_address_3?: string;
  site_postbox?: string;
  site_city?: string;
  site_state?: string;
  site_postcode?: string;
  site_country?: string;
  site_gross_perimeter?: string;
  site_gross_area?: string;

  building_name?: string;
  building_description?: string;
  building_id?: string;

  contact_fullname?: string;
  contact_prefixtitle?: string;
  contact_givenname?: string;
  contact_middlename?: string;
  contact_familyname?: string;
  contact_suffixtitle?: string;
  contact_nameorder?: string;
  contact_id?: string;
  contact_role?: string;
  contact_department?: string;
  contact_company?: string;
  contact_companycode?: string;
  contact_fulladdress?: string;
  contact_address_1?: string;
  contact_address_2?: string;
  contact_address_3?: string;
  contact_postbox?: string;
  contact_city?: string;
  contact_state?: string;
  contact_postcode?: string;
  contact_country?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_fax?: string;
  contact_web?: string;

  cad_technician_fullname?: string;
  cad_technician_prefixtitle?: string;
  cad_technician_givenname?: string;
  cad_technician_middlename?: string;
  cad_technician_familyname?: string;
  cad_technician_suffixtitle?: string;
  cad_technician_nameorder?: string;

  client_fullname?: string;
  client_prefixtitle?: string;
  client_givenname?: string;
  client_middlename?: string;
  client_familyname?: string;
  client_suffixtitle?: string;
  client_nameorder?: string;
  client_company?: string;
  client_fulladdress?: string;
  client_address_1?: string;
  client_address_2?: string;
  client_address_3?: string;
  client_postbox?: string;
  client_city?: string;
  client_state?: string;
  client_postcode?: string;
  client_country?: string;
  client_email?: string;
  client_phone?: string;
  client_fax?: string;

  ed_report_header?: string;
  custom_building?: string;
  custom_architect?: string;
  custom_client?: string;
  construction_cost?: number;
  ratio_rehab?: number;
  ratio_extension?: number;
  complexity_rate?: number;
  base_fee_percent?: number;
  exe_fee_percent?: number;
  comp_fee_percent?: number;
  vat_rate?: number;
  decimal_precision?: number;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  // Nullable: a Zoho-imported invoice lands with no project (Zoho has a
  // customer, not one of our projects — see zohoInvoiceToLocalRow in
  // server/zohoSync.ts) until it's attached to one from the edit modal.
  project_id: string | null;
  project_name?: string;
  amount: number;
  tax_amount?: number;
  total_amount?: number;
  status: 'Draft' | 'Sent' | 'Paid' | 'Overdue';
  invoice_type?: 'standard' | 'acompte';
  mission_id?: string;
  mission_name?: string;
  advancement_pct?: number;
  // Double numérotation : affaire_invoice_number est une référence métier
  // complémentaire par affaire ("26014-ACO-02"), affichée à côté du numéro
  // séquentiel légal (invoice_number) — jamais à sa place. phases porte la
  // ventilation par phase de mission d'un acompte (plusieurs phases par facture).
  affaire_invoice_number?: string;
  phases?: InvoicePhase[];
  due_date: string;
  issue_date: string;
  description: string;
  created_at: string;
  // Factur-X / EN 16931 fields
  seller_name?: string;
  seller_address?: string;
  seller_siret?: string;
  seller_vat_number?: string;
  seller_iban?: string;
  seller_bic?: string;
  currency?: string;
  vat_rate?: number;
  items?: InvoiceItem[];
  superpdp_id?: number;
  superpdp_status?: string;
  // Chorus Pro (facturation B2G maîtrise d'ouvrage publique)
  chorus_pro_id?: string;
  chorus_pro_status?: string;
  buyer_siret?: string;
  buyer_service_code?: string;
  engagement_number?: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
}

export interface InvoicePhase {
  phase_id: string;
  phase_name: string;
  avancement_pct: number;
  montant_phase: number;
}

export interface SiteReport {
  id: string;
  project_id: string;
  date: string;
  report_number: number;
  pageFormat?: 'portrait' | 'landscape';
  stakeholders?: { name: string; role: string }[];
  companies?: { name: string; trade: string }[];
  meetingNotes?: string;
  nextMeeting?: string;
  meteo?: string;
  temperature?: number;
  effectif_total?: number;
}

export interface SiteReportNote {
  id: string;
  report_id: string;
  category: string;
  note_number: number;
  responsible_company?: string;
  issue_date: string;
  due_date?: string;
  realization_date?: string;
  status: 'open' | 'done' | 'A FAIRE' | 'EN COURS' | 'LEVÉE' | 'URGENT';
  text: string;
  lot_concerne?: string;
  photo_url?: string;
  position?: { x: number; y: number };
  description?: string;
  statut?: 'A FAIRE' | 'EN COURS' | 'LEVÉE' | 'URGENT';
}

export interface Observation {
  id: string;
  project_id: string;
  lot_id?: string;
  lot?: Pick<ProjectLot, 'id' | 'lot_number' | 'lot_title'>;
  contact_id?: string;
  texte: string;
  statut: 'À faire' | 'En cours' | 'Levée' | 'Urgent' | 'Refusée';
  due_date?: string;
  created_report_id?: string;
  created_report_number?: number;
  resolved_report_id?: string;
  resolved_report_number?: number;
  number?: number;
  created_at?: string;
  report_ids?: string[];
}

export interface DPGFItem {
  id: string;
  project_id: string;
  designation: string;
  unite: string;
  quantite_prevue: number;
  prix_unitaire_ht: number;
}

export interface Situation {
  id: string;
  project_id: string;
  numero_situation: number;
  date_situation: string;
  etat: 'Brouillon' | 'Validée' | 'Payée';
}

export interface DetailSituation {
  id: string;
  situation_id: string;
  dpgf_item_id: string;
  pourcentage_avancement: number;
}

export interface ArticleType {
  id: string;
  code_nacre: string;
  designation: string;
  texte_cctp_standard: string;
}

export interface LigneOuvrage {
  id: string;
  id_lot: string;
  id_article_type: string;
  description_adaptee: string;
}

export interface DonneeChiffree {
  id_ligne_ouvrage: string;
  quantite: number;
  prix_unitaire: number;
  unite: string;
}

export type MeetingType = 'projet' | 'visite_candidature' | 'visite_proposition';

export interface MeetingAttendee {
  id: string;
  meeting_id?: string;
  contact_id: string;
  role?: string;
  contact?: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'company_name' | 'job_title' | 'phone_mobile' | 'phone_work' | 'phone' | 'email' | 'email_work' | 'email_home'>;
}

export interface MeetingPhoto {
  id: string;
  meeting_id: string;
  file_url: string;
  caption?: string;
  uploaded_at: string;
}

// ── Agents IA ──────────────────────────────────────────────────────────────

export type AgentContextScope = 'meetings' | 'contacts' | 'projects' | 'documents' | 'tasks';

export interface Agent {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  role_title: string;
  avatar_initials: string;
  avatar_color: string;
  tone?: string;
  directives?: string;
  system_prompt_override?: string;
  context_scopes: AgentContextScope[];
  is_active: boolean;
  is_system_template: boolean;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  tenant_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AgentTokenUsage {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  tokens_used: number;
  cost_eur_cents?: number;
  created_at: string;
}

export interface AgentChatResponse {
  reply: string;
  tokens_used: number;
  remaining_balance: number;
}

// ── Meetings ────────────────────────────────────────────────────────────────

export interface Meeting {
  id: string;
  tenant_id?: string;
  project_id?: string;
  proposal_id?: string;
  tender_id?: string;
  type: MeetingType;
  title: string;
  date: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
  photos?: MeetingPhoto[];
  attendees?: MeetingAttendee[];
}

export interface ContratMOEMission {
  id: string;
  name: string;
  pct?: number;
  incluse: boolean;
}

export interface ContratCotraitant {
  id: string;
  contact_id?: string;
  contact_name?: string;
  specialty?: string;
  fee_pct?: number;
  montant_honoraires?: number;
}

export interface ContratSousTraitant {
  id: string;
  contact_id?: string;
  contact_name?: string;
  specialty?: string;
  montant?: number;
  paiement_direct_moa: boolean;
}

export interface ContratMOE {
  id: string;
  tenant_id?: string;
  numero?: string;
  type_contrat: 'construction_neuve' | 'rehabilitation' | 'concours' | 'amo' | 'diagnostic' | 'urbanisme';
  type_moa: 'prive' | 'public' | 'copropriete';
  status: 'Brouillon' | 'Envoyé' | 'Signé' | 'Résilié';
  client_id?: string;
  client_name?: string;
  project_id?: string;
  project_name?: string;
  intitule_projet?: string;
  adresse_travaux?: string;
  surface_plancher?: number;
  budget_previsionnel?: number;
  mode_honoraires: 'forfait' | 'pourcentage';
  montant_honoraires?: number;
  taux_honoraires?: number;
  indice_revision?: string;
  date_debut?: string;
  date_fin?: string;
  missions_list?: ContratMOEMission[];
  cotraitants?: ContratCotraitant[];
  sous_traitants?: ContratSousTraitant[];
  delai_execution?: number;
  penalites_retard?: number;
  clause_resiliation?: string;
  clause_propriete_intellectuelle?: boolean;
  clause_mediation?: boolean;
  assureur?: string;
  numero_police?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface NoteHonorairePhase {
  phase_id: string;
  phase_name: string;
  avancement_pct: number;
  montant_phase: number;
}

export interface NoteHonoraireCotraitant {
  contact_id?: string;
  nom: string;
  montant_ht: number;
  tva_rate: number;
  montant_ttc: number;
}

export interface NoteHonoraireSousTraitant {
  contact_id?: string;
  nom: string;
  montant_ht: number;
  tva_rate: number;
  montant_ttc: number;
  paiement_direct_moa: boolean;
}

// ─── MAF — Déclaration des activités professionnelles ────────────────────────

export type MafIntercalaire =
  | 'jaune' | 'vert' | 'ami' | 'grand_chantier'
  | 'violet' | 'orange_clair' | 'orange_fonce'
  | 'bleu' | 'rose' | 'tabac' | 'gris' | 'puc';

export interface MafProjectData {
  id: string;
  tenantId: string;
  projectId?: string;
  declarationYear: number;
  intercalaire: MafIntercalaire;
  // Financier annuel
  montantCumulFinAnnee?: number;
  montantCumulAnneePrecedente?: number;
  // Honoraires
  honorairesHt?: number;
  // Cas particuliers
  pucAssureur?: string;
  conventionSpeciale?: string;
  accordGarantieMaf?: boolean;
  cotisationProvisionnelle?: number;
  tauxCotisationPermil?: number;
  notes?: string;
  statut?: 'brouillon' | 'declaree';
  sourceSituationId?: string;
  sourceSituationDate?: string;
  sourceSituationNumero?: number;
  createdAt?: string;
  updatedAt?: string;
  // Champs projet joints (lecture seule, depuis projects)
  project?: Partial<Project>;
}

export interface MafCostResult {
  montantM: number;
  assiette: number;
  cotisationEstimee: number;
  intercalaire: MafIntercalaire;
  label: string;
  tauxPermil: number;
}

export interface MafSummaryIntercalaire {
  entries: (MafProjectData & { project?: Partial<Project> })[];
  totalAssiette: number;
  cotisationEstimee: number;
  tauxPermil: number;
}

export interface MafSummary {
  year: number;
  numeroAdherent?: string;
  intercalaires: Partial<Record<MafIntercalaire, MafSummaryIntercalaire>>;
  cotisationTotaleEstimee: number;
}

// ─── Guide MIQCP — Assistant de calcul de la complexité et du taux d'honoraires ──

export interface MiqcpCriterionScore {
  criterionId: string; // ex. 'contexte_1'
  score: -2 | -1 | 0 | 1 | 2;
}

export interface MiqcpAssessment {
  domaineCode: string;
  ouvrageCode: string;
  montantTravauxHT: number;
  criteriaScores: MiqcpCriterionScore[];
  tauxReference: number;
  coefficientComplexite: number;
  tauxApplicable: number;
  computedAt: string;
}

export interface NoteHonoraires {
  id: string;
  tenant_id?: string;
  project_id: string;
  contrat_id?: string;
  numero?: string;
  date?: string;
  objet?: string;
  status: 'Brouillon' | 'Envoyée' | 'Payée';
  phases?: NoteHonorairePhase[];
  montant_ht: number;
  tva_rate: number;
  montant_tva: number;
  montant_ttc: number;
  cotraitants_facturation?: NoteHonoraireCotraitant[];
  sous_traitants_facturation?: NoteHonoraireSousTraitant[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}
