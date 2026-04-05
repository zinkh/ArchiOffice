import Dexie, { Table } from 'dexie';

export interface Project {
  id: string;
  name: string;
  client: string;
  client_id?: string;
  status: string;
  budget?: number;
  category?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  image_url?: string;
  project_code?: string;
  address?: string;
  client_siret?: string;
  client_vat_number?: string;
  client_email?: string;
  is_public_client?: number;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  company_name?: string;
  // Add other fields as needed
}

export class ArchiManagerDatabase extends Dexie {
  projects!: Table<Project>;
  contacts!: Table<Contact>;

  constructor() {
    super('ArchiManagerDatabase');
    this.version(1).stores({
      projects: 'id, name, client, status',
      contacts: 'id, first_name, last_name, email, company_name'
    });
  }
}

export const db = new ArchiManagerDatabase();
