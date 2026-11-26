// Client de l'API « Base de données » du cabinet (server/routes/knowledgeBase.ts), au-dessus d'apiFetch :
// jeton et en-tête de cabinet posés par lui. Types dans src/lib/kb.ts.
import { apiFetch } from './api';
import type { KbOption, KbPage, KbProperty, KbPropertyType, KbViewConfig } from './kb';
import type { KbImportRequest } from './kbImport';

export interface KbImportReport {
  created: number;
  would_create?: number;
  properties_created: string[];
  options_created: number;
  errors: Array<{ row: number; column?: string; error: string }>;
}

export interface KbView {
  id: string;
  database_id: string;
  name: string;
  type: 'table';
  config: KbViewConfig;
  position: number;
}

export interface KbPagePatch {
  title?: string;
  icon?: string | null;
  is_favorite?: boolean;
  content?: unknown;
  project_id?: string | null;
  properties?: Record<string, unknown>;
}

export interface KbCreateBody {
  kind?: 'page' | 'database';
  parent_id?: string | null;
  title?: string;
  icon?: string | null;
  content?: unknown;
  properties?: Record<string, unknown>;
}

const json = (method: string, body?: unknown, init?: RequestInit): RequestInit => ({
  ...init,
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const kbApi = {
  /** Liste légère (sans contenu), corbeille comprise. */
  tree: () => apiFetch<KbPage[]>('/api/kb/tree'),
  search: (q: string) => apiFetch<KbPage[]>(`/api/kb/search?q=${encodeURIComponent(q)}`),
  getPage: (id: string) => apiFetch<KbPage>(`/api/kb/pages/${encodeURIComponent(id)}`),
  createPage: (body: KbCreateBody) => apiFetch<KbPage>('/api/kb/pages', json('POST', body)),
  /** `keepalive` : l'envoi survit à la fermeture de l'onglet (enregistrement avant de quitter). */
  updatePage: (id: string, patch: KbPagePatch, init?: RequestInit) =>
    apiFetch<KbPage>(`/api/kb/pages/${encodeURIComponent(id)}`, json('PUT', patch, init)),
  movePage: (id: string, parentId: string | null, position: number) =>
    apiFetch<KbPage>(`/api/kb/pages/${encodeURIComponent(id)}/move`, json('PATCH', { parent_id: parentId, position })),
  trashPage: (id: string) => apiFetch<{ success: boolean }>(`/api/kb/pages/${encodeURIComponent(id)}`, json('DELETE')),
  restorePage: (id: string) => apiFetch<{ success: boolean }>(`/api/kb/pages/${encodeURIComponent(id)}/restore`, json('POST', {})),
  deletePermanently: (id: string) => apiFetch<{ success: boolean }>(`/api/kb/pages/${encodeURIComponent(id)}/permanent`, json('DELETE')),

  properties: (databaseId: string) => apiFetch<KbProperty[]>(`/api/kb/databases/${encodeURIComponent(databaseId)}/properties`),
  rows: (databaseId: string) => apiFetch<KbPage[]>(`/api/kb/databases/${encodeURIComponent(databaseId)}/rows`),
  createProperty: (databaseId: string, body: { name: string; type: Exclude<KbPropertyType, 'title'>; options?: Array<Partial<KbOption>> }) =>
    apiFetch<KbProperty>(`/api/kb/databases/${encodeURIComponent(databaseId)}/properties`, json('POST', body)),
  updateProperty: (databaseId: string, propertyId: string, patch: { name?: string; options?: Array<Partial<KbOption>>; position?: number; width?: number | null }) =>
    apiFetch<KbProperty>(`/api/kb/databases/${encodeURIComponent(databaseId)}/properties/${encodeURIComponent(propertyId)}`, json('PUT', patch)),
  deleteProperty: (databaseId: string, propertyId: string) =>
    apiFetch<{ success: boolean }>(`/api/kb/databases/${encodeURIComponent(databaseId)}/properties/${encodeURIComponent(propertyId)}`, json('DELETE')),

  /** Import en lot : `dryRun` valide sans écrire. Un refus (422) porte `errors` par ligne et par colonne. */
  importRows: (databaseId: string, body: KbImportRequest, dryRun = false) =>
    apiFetch<KbImportReport>(`/api/kb/databases/${encodeURIComponent(databaseId)}/import`, json('POST', { ...body, ...(dryRun ? { dry_run: true } : {}) })),

  views: (databaseId: string) => apiFetch<KbView[]>(`/api/kb/databases/${encodeURIComponent(databaseId)}/views`),
  updateView: (databaseId: string, viewId: string, patch: { name?: string; config?: KbViewConfig }) =>
    apiFetch<KbView>(`/api/kb/databases/${encodeURIComponent(databaseId)}/views/${encodeURIComponent(viewId)}`, json('PUT', patch)),
};
