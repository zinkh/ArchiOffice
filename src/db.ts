import Dexie, { Table } from 'dexie';
import { Project, Contact, Tender, Proposal, Invoice, Milestone, Task, ContactCategory, ProjectCategory, ProjectTemplate, TeamMember as UserProfile } from './types';

export class AppDatabase extends Dexie {
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
  syncQueue!: Table<{ id?: number; table: string; method: string; data: any }>;
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
      users: 'id, email'
    });
  }
}

export const db = new AppDatabase();
