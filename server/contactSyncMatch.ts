// Rapprochement d'un contact importé (Google Contacts, CardDAV) avec une fiche du cabinet.
//
// L'ancien code cherchait par e-mail seulement, avec `.maybeSingle()` : un contact sans
// e-mail (une société, le cas courant chez Google) ne retrouvait jamais sa fiche et était
// recréé à CHAQUE synchronisation, et dès que deux fiches partageaient un e-mail,
// `maybeSingle` répondait une erreur ignorée et en faisait créer une de plus.
//
// Ordre de rapprochement : identifiant Google (`google_resource_name`), puis adresse
// e-mail (les trois champs, sans tenir compte de la casse), puis nom (`nameKey` : personne
// prénom + nom dans n'importe quel ordre, ou société sans forme juridique). Un contact
// personnel n'est jamais rapproché : il n'appartient qu'à son créateur.
import { nameKey } from '../src/lib/contactMerge';

export interface SyncContactRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  email_work?: string | null;
  email_home?: string | null;
  email_other?: string | null;
  google_resource_name?: string | null;
  is_personal?: boolean | null;
  created_at?: string | null;
}

export interface SyncCandidate {
  resourceName?: string | null;
  email?: string | null;
  email_work?: string | null;
  email_home?: string | null;
  email_other?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}

export interface ContactSyncIndex {
  byResource: Map<string, SyncContactRow>;
  byEmail: Map<string, SyncContactRow>;
  byName: Map<string, SyncContactRow>;
}

const normEmail = (v?: string | null): string => (v || '').trim().toLowerCase();

/** La fiche la plus ancienne l'emporte : le résultat ne dépend pas de l'ordre de lecture. */
function keepOldest(map: Map<string, SyncContactRow>, key: string, row: SyncContactRow) {
  if (!key) return;
  const current = map.get(key);
  if (!current || (row.created_at || '') < (current.created_at || '')) map.set(key, row);
}

export function emptySyncIndex(): ContactSyncIndex {
  return { byResource: new Map(), byEmail: new Map(), byName: new Map() };
}

export function addToSyncIndex(index: ContactSyncIndex, row: SyncContactRow): void {
  if (row.is_personal) return;
  if (row.google_resource_name) keepOldest(index.byResource, row.google_resource_name, row);
  for (const email of [row.email, row.email_work, row.email_home, row.email_other]) keepOldest(index.byEmail, normEmail(email), row);
  keepOldest(index.byName, nameKey(row as any), row);
}

export function buildSyncIndex(rows: SyncContactRow[]): ContactSyncIndex {
  const index = emptySyncIndex();
  for (const row of rows) addToSyncIndex(index, row);
  return index;
}

export function findExistingContact(index: ContactSyncIndex, candidate: SyncCandidate): SyncContactRow | undefined {
  if (candidate.resourceName) {
    const byResource = index.byResource.get(candidate.resourceName);
    if (byResource) return byResource;
  }
  for (const raw of [candidate.email, candidate.email_work, candidate.email_home, candidate.email_other]) {
    const email = normEmail(raw);
    if (!email) continue;
    const byEmail = index.byEmail.get(email);
    if (byEmail) return byEmail;
  }
  const key = nameKey(candidate as any);
  return key ? index.byName.get(key) : undefined;
}

// ── Adresses e-mail typées (Google Contacts : Travail, Domicile, Autre) ─────────────────────
// Google range chaque adresse sous un type (`work`, `home`, `other`, ou aucun / personnalisé).
// La fiche a trois champs correspondants et `email`, l'adresse principale (travail d'abord)
// que lisent le tableau et l'envoi vers Google historique.
export type EmailSlot = 'email_work' | 'email_home' | 'email_other';
export interface TypedEmails {
  email_work: string;
  email_home: string;
  email_other: string;
  email: string;
}

const SLOT_ORDER: EmailSlot[] = ['email_work', 'email_home', 'email_other'];
const PREFERRED_SLOT: Record<string, EmailSlot | undefined> = { work: 'email_work', home: 'email_home', other: 'email_other' };

/** Reporte les adresses d'une personne Google sur les champs de la fiche, selon leur type. */
export function emailsFromGoogle(list?: Array<{ value?: string; type?: string }> | null): TypedEmails {
  const out: TypedEmails = { email_work: '', email_home: '', email_other: '', email: '' };
  const seen = new Set<string>();
  for (const entry of list || []) {
    const value = (entry?.value || '').trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    const preferred = PREFERRED_SLOT[(entry.type || '').toLowerCase()];
    // Type connu et place libre : on le respecte. Sinon (sans type, personnalisé, ou deuxième
    // adresse du même type) : première place libre, travail d'abord, sans jamais en écraser une.
    const slot = (preferred && !out[preferred]) ? preferred : SLOT_ORDER.find(s => !out[s]);
    if (slot) out[slot] = value;
  }
  out.email = out.email_work || out.email_home || out.email_other;
  return out;
}

/** Inverse : les adresses de la fiche, typées, telles que Google les attend. */
export function emailsForGoogle(contact: Partial<TypedEmails>): Array<{ value: string; type?: string }> {
  const typed: Array<{ value: string; type?: string }> = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined, type?: string) => {
    const v = (value || '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    typed.push(type ? { value: v, type } : { value: v });
  };
  push(contact.email_work, 'work');
  push(contact.email_home, 'home');
  push(contact.email_other, 'other');
  // Fiche ancienne (ou importée) dont seul `email` est renseigné : envoyée telle quelle, sans type.
  push(contact.email);
  return typed;
}

/** Toutes les adresses d'une personne Google, pour rapprocher une fiche locale. */
export function allGoogleEmails(list?: Array<{ value?: string }> | null): string[] {
  return (list || []).map(e => (e?.value || '').trim()).filter(Boolean);
}

/** Une valeur importée vide n'efface jamais ce que la fiche porte déjà. */
export function nonEmptyFields<T extends Record<string, any>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => !(v === '' || v === null || v === undefined)),
  ) as Partial<T>;
}
