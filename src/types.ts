export type DocumentPhase = 'ESQ' | 'APS' | 'APD' | 'PC' | 'PRO' | 'DCE' | 'ACT' | 'VISA' | 'DET' | 'AOR' | 'Général';

export interface Document {
  id: string;
  project_id: string;
  name: string;
  category: 'Architectural Drawing' | 'Contract' | 'Report' | 'Other';
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
  system_role: 'admin' | 'pm' | 'user';
  senderOption?: 'agency' | 'personal';
  defaultEmailTemplate?: string;
  phone?: string;
  address?: string;
  jobTitle?: string;
  department?: string;
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
  mandatory_visit?: boolean;
  visit_date?: string;
  withdrawal_deadline?: string;
  specialties_list?: TenderSpecialty[];
  milestones_list?: Milestone[];
  archived?: boolean;
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
  specialties_list?: ProposalSpecialty[];
  fee_distribution?: string; // JSON string for reactgrid data

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
  project_id: string;
  project_name?: string;
  amount: number;
  tax_amount?: number;
  total_amount?: number;
  status: 'Draft' | 'Sent' | 'Paid' | 'Overdue';
  invoice_type?: 'standard' | 'acompte';
  mission_id?: string;
  mission_name?: string;
  advancement_pct?: number;
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
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
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
