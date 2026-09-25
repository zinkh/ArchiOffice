import Dexie, { Table } from 'dexie';
import { Project, Contact, Tender, Proposal, Invoice, Milestone, Task, ContactCategory, ProjectCategory, ProjectTemplate, TeamMember as UserProfile } from './types';

/**
 * Une écriture (POST/PUT/PATCH) différée faute de réseau, rejouée par
 * `src/lib/offlineQueue.ts`. `id` sert de clé d'idempotence : pour une
 * création, c'est l'id généré côté client pour l'entité elle-même
 * (réunion, réserve, observation…) — le serveur l'accepte tel quel et
 * l'insert y est protégé contre le doublon, donc rejouer deux fois la même
 * entrée ne crée jamais deux lignes.
 */
export interface PendingWrite {
  id: string;
  tenantId: string | null;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  kind: 'json' | 'multipart';
  jsonBody?: any;
  blob?: Blob;
  blobFieldName?: string;
  blobFilename?: string;
  extraFields?: Record<string, string>;
  entity: 'meeting' | 'meetingPhoto' | 'reserve' | 'reservePhoto' | 'gpaReserve' | 'gpaReservePhoto' | 'observation' | 'observationPhoto' | 'project';
  status: 'pending' | 'error';
  attempts: number;
  lastError?: string;
  createdAt: number;
}

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
  pendingWrites!: Table<PendingWrite>;
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
      users: 'id, email'
    });
    // v5 : l'ancienne `syncQueue` (schéma `++id, table, method`) n'a jamais été
    // câblée à rien — table morte, supprimée plutôt que migrée. `pendingWrites`
    // la remplace avec une clé primaire choisie (l'id de l'entité, pour
    // l'idempotence), ce que Dexie ne permet pas de faire en modifiant la même
    // table en place.
    this.version(5).stores({
      syncQueue: null,
      pendingWrites: 'id, tenantId, status, createdAt',
    });
  }
}

export const db = new AppDatabase();
