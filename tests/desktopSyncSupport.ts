// Outils communs aux tests de la synchronisation desktop (/api/desktop/v1) : un acteur
// avec son jeton d'appareil, des affaires et des documents d'amorçage.
import crypto from 'crypto';
import request from 'supertest';
import type { Express } from 'express';
import { authHeader, fakeSupabaseAdmin, makeUser, makeTenant } from './testServer';

export const API = '/api/desktop/v1';

export interface Actor {
  userId: string;
  tenantId: string;
  jwt: string;
  deviceToken: string;
  /** En-têtes d'un appel du client natif : jeton d'appareil et cabinet. */
  headers: Record<string, string>;
}

export async function registerDevice(app: Express, jwt: string, platform: 'windows' | 'macos' = 'windows'): Promise<string> {
  const res = await request(app).post(`${API}/devices`).set(authHeader(jwt)).send({ name: 'Poste test', platform, appVersion: '1.0.0' });
  if (res.status !== 201) throw new Error(`enregistrement de l'appareil refusé : ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Une personne du cabinet, avec un appareil enregistré. */
export async function makeActor(
  app: Express,
  tenantId: string,
  role: 'admin' | 'manager' | 'pm' | 'user' = 'admin',
): Promise<Actor> {
  const { userId, token: jwt } = makeUser(tenantId, role);
  const deviceToken = await registerDevice(app, jwt);
  return {
    userId, tenantId, jwt, deviceToken,
    headers: { Authorization: `Bearer ${deviceToken}`, 'X-Tenant-Id': tenantId },
  };
}

let counter = 0;
const next = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export function seedProject(tenantId: string, id: string, overrides: Record<string, any> = {}) {
  fakeSupabaseAdmin.seed('projects', [{
    id, tenant_id: tenantId, project_code: '26014', name: 'Villa Martin', ...overrides,
  }]);
  return id;
}

/** Un document d'affaire stocké dans Supabase, avec son objet. */
export function seedDocument(tenantId: string, overrides: Record<string, any> = {}) {
  const id = overrides.id ?? next('doc');
  const projectId = 'project_id' in overrides ? overrides.project_id : null;
  const name = overrides.name ?? 'Plan.pdf';
  const path = `${tenantId}/${projectId ?? 'general'}/${id}/${name}`;
  const row = {
    id, tenant_id: tenantId, project_id: projectId, resource_type: 'projects', resource_id: projectId,
    name, category: 'Plans', phase: 'APD', version: 1, indice: 'A',
    file_url: `https://fake.supabase.test/storage/v1/object/public/documents/${path}`,
    storage_backend: 'supabase', uploaded_by: 'Test', uploaded_at: new Date().toISOString(),
    doc_statut: 'en_cours', size_bytes: 10, mime_type: 'application/pdf', deleted_at: null,
    ...overrides,
  };
  fakeSupabaseAdmin.seed('documents', [row]);
  fakeSupabaseAdmin.putObject('documents', path, 'contenu');
  return row;
}

export const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

let seq = 100000;
/** Un événement du journal, comme l'écriraient les déclencheurs de la migration. */
export function seedChange(tenantId: string, type: string, nodeId: string, projectId: string | null = null) {
  seq += 1;
  fakeSupabaseAdmin.seed('desktop_changes', [{
    seq, tenant_id: tenantId, type, node_id: nodeId, project_id: projectId, created_at: new Date().toISOString(),
  }]);
  return seq;
}

export function seedLockMode(tenantId: string, mode: 'off' | 'advisory' | 'enforced') {
  fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantId, desktop_lock_mode: mode }]);
}

/** A cloud subscription with a paid-through date, including Enterprise contracts. */
export function makeDriveTenant(overrides: Record<string, any> = {}) {
  return makeTenant({ plan: 'pro', trial_ends_at: new Date(Date.now() + 86400000).toISOString(), ...overrides });
}
