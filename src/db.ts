import Dexie, { Table } from 'dexie';
import { Project, Contact, Tender, Proposal, Invoice, Milestone, Task, ContactCategory, ProjectCategory, ProjectTemplate, TeamMember as UserProfile } from './types';

export class AppDatabase extends Dexie {
  // Existing tables
  projects!: Table<Project>;
  contacts!: Table<Contact>;
  tenders!: Table<Tender>;
  proposals!: Table<Proposal>;
  invoices!: Table<Invoice>;
  milestones!: Table<Milestone>;
  tasks!: Table<Task>;
  contactCategories!: Table<ContactCategory>;
  projectCategories!: Table<ProjectCategory>;
  projectTemplates!: Table<ProjectTemplate>;
  syncQueue!: Table<{ id?: number; table: string; method: string; data: any; url?: string; timestamp?: number }>;
  settings!: Table<{
    id: string;
    agencyName: string;
    address: string;
    phone: string;
    email: string;
    siret: string;
    vatNumber: string;
    currency: string;
    language: string;
    senderOption: 'agency' | 'personal';
    defaultEmailTemplate: string;
    logoUrl: string;
    seller_iban?: string;
    seller_bic?: string;
  }>;
  actData!: Table<any>;
  detData!: Table<any>;
  users!: Table<UserProfile>;

  // Tables added in v5
  ordresDeService!: Table<any>;
  specifications!: Table<any>;
  invoiceItems!: Table<any>;
  projectCotraitants!: Table<any>;
  projectStakeholders!: Table<any>;
  proposalSpecialties!: Table<any>;
  projectLots!: Table<any>;
  siteReports!: Table<any>;
  siteReportNotes!: Table<any>;
  documents!: Table<any>;
  documentVersions!: Table<any>;
  visas!: Table<any>;
  receptions!: Table<any>;
  reserves!: Table<any>;
  plans!: Table<any>;
  dpgfItems!: Table<any>;
  situations!: Table<any>;
  detailSituations!: Table<any>;
  cctps!: Table<any>;
  dpgfs!: Table<any>;

  constructor() {
    super('AppDatabase');

    this.version(4).stores({
      projects: 'id, name, client, status',
      contacts: 'id, last_name, first_name, company_name, category',
      tenders: 'id, title, status',
      proposals: 'id, title, status',
      invoices: 'id, invoice_number, status',
      milestones: 'id, project_id',
      tasks: 'id, project_id',
      contactCategories: 'id, name',
      projectCategories: 'id, name',
      projectTemplates: 'id, name',
      syncQueue: '++id, table, method',
      settings: 'id',
      actData: 'projectId',
      detData: 'id, projectId',
      users: 'id, email',
    });

    this.version(5).stores({
      projects: 'id, name, client, status',
      contacts: 'id, last_name, first_name, company_name, category',
      tenders: 'id, title, status',
      proposals: 'id, title, status',
      invoices: 'id, invoice_number, status',
      milestones: 'id, project_id',
      tasks: 'id, project_id',
      contactCategories: 'id, name',
      projectCategories: 'id, name',
      projectTemplates: 'id, name',
      syncQueue: '++id, table, method, timestamp',
      settings: 'id',
      actData: 'projectId',
      detData: 'id, projectId',
      users: 'id, email',
      // New in v5
      ordresDeService: 'id, project_id, status',
      specifications: 'id, project_id',
      invoiceItems: 'id, invoice_id',
      projectCotraitants: 'id, project_id',
      projectStakeholders: 'id, project_id',
      proposalSpecialties: 'id, proposal_id',
      projectLots: 'id, project_id',
      siteReports: 'id, project_id',
      siteReportNotes: 'id, report_id',
      documents: 'id, project_id',
      documentVersions: 'id, document_id',
      visas: 'id, project_id',
      receptions: 'id, project_id',
      reserves: 'id, project_id',
      plans: 'id, project_id',
      dpgfItems: 'id, dpgf_id',
      situations: 'id, project_id',
      detailSituations: 'id, situation_id',
      cctps: 'id, project_id',
      dpgfs: 'id, project_id',
    });
  }
}

export const db = new AppDatabase();
