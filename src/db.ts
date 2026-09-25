import Dexie, { Table } from 'dexie';
import { Project, Contact, Tender, Proposal, Invoice, Milestone, Task, ContactCategory, ProjectCategory, ProjectTemplate, TeamMember as UserProfile, Meeting, Reserve, GpaReserve, Observation } from './types';

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
  entity: 'meeting' | 'meetingPhoto' | 'reserve' | 'reservePhoto' | 'gpaReserve' | 'gpaReservePhoto' | 'observation' | 'observationPhoto' | 'project' | 'siteReport';
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
  // Cache de lecture hors-ligne « suivi de chantier » (voir
  // src/lib/offlineReadCache.ts) : jamais vidées en bloc comme le ferait un
  // `table.clear()` global, seulement les lignes du périmètre rechargé
  // (un projet, un devis...) — sinon consulter les réunions d'une affaire
  // effacerait le cache de toutes les autres.
  meetingsCache!: Table<Meeting>;
  reservesCache!: Table<Reserve>;
  gpaReservesCache!: Table<GpaReserve>;
  observationsCache!: Table<Observation>;
  // Préchargement « disponible hors connexion » (src/lib/offlinePrefetch.ts) :
  // le payload de GET /api/projects/:id/full tel quel, un seul projet par
  // ligne — pas de risque d'écraser le cache d'un autre projet ici, jamais
  // besoin du même garde-fou que les tables *Cache ci-dessus.
  projectSnapshots!: Table<{ id: string; data: any; cachedAt: number }>;
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
    // v6 : cache de lecture hors-ligne pour réunions, réserves OPR/GPA et
    // observations — voir src/lib/offlineReadCache.ts et CLAUDE.md
    // « fiabiliser la synchro hors-ligne ».
    this.version(6).stores({
      meetingsCache: 'id, project_id, proposal_id, tender_id',
      reservesCache: 'id, project_id',
      gpaReservesCache: 'id, project_id',
      observationsCache: 'id, project_id',
    });
    // v7 : préchargement par projet coché « disponible hors connexion »
    // (offline_enabled) — voir src/lib/offlinePrefetch.ts et
    // supabase/migrate_project_offline_enabled.sql.
    this.version(7).stores({
      projectSnapshots: 'id, cachedAt',
    });
  }
}

export const db = new AppDatabase();
