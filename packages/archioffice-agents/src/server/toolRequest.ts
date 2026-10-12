// Briques communes aux outils d'agent qui relisent une liste, la modifient puis la renvoient
// par l'API REST de l'application (boucle locale, jeton de la personne).
import { internalHeaders, type InternalAuth } from './internalApi.js';

export type Json = Record<string, any>;
export type ToolRequest = (path: string, method?: string, body?: Json) => Promise<{ res: Response; json: any }>;

export const norm = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase();
export const text = (v: unknown) => String(v ?? '').trim();
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function makeRequest(baseUrl: string, auth: InternalAuth): ToolRequest {
  return async (path, method = 'GET', body) => {
    const res = await fetch(baseUrl + path, { method, headers: internalHeaders(auth, body ? { 'Content-Type': 'application/json' } : undefined), body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json().catch(() => null);
    return { res, json };
  };
}

export const contactLabel = (c: Json): string =>
  text(c.company_name) || [text(c.first_name), text(c.last_name)].filter(Boolean).join(' ');

export interface ResolvedContact { contact_id: string | null; name: string; ambigu?: Json[]; inconnu?: boolean }

/** Résout « contact_id ou nom » vers une fiche du cabinet. Les contacts ne sont lus qu'une fois, à la demande. */
export function createContactResolver(request: ToolRequest) {
  let contacts: Json[] | null = null;
  const load = async (): Promise<Json[]> => {
    if (contacts) return contacts;
    const { res, json } = await request('/api/contacts');
    contacts = res.ok && Array.isArray(json) ? json : [];
    return contacts;
  };
  return async (it: Json): Promise<ResolvedContact> => {
    const id = text(it.contact_id);
    const nom = text(it.nom);
    if (!id && !nom) return { contact_id: null, name: '' };
    const all = await load();
    if (id) {
      const c = all.find(x => String(x.id) === id);
      return c ? { contact_id: id, name: contactLabel(c) } : { contact_id: null, name: nom, inconnu: true };
    }
    const matches = all.filter(c => norm(contactLabel(c)) === norm(nom) || norm(c.company_name) === norm(nom));
    if (matches.length === 1) return { contact_id: String(matches[0].id), name: contactLabel(matches[0]) };
    if (matches.length > 1) return { contact_id: null, name: nom, ambigu: matches.map(m => ({ id: m.id, nom: contactLabel(m) })) };
    return { contact_id: null, name: nom };
  };
}

export const failure = (error: string, extra: Json = {}): { response: Json } => ({ response: { error, ...extra } });
