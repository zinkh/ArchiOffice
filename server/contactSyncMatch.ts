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
  google_resource_name?: string | null;
  is_personal?: boolean | null;
  created_at?: string | null;
}

export interface SyncCandidate {
  resourceName?: string | null;
  email?: string | null;
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
  for (const email of [row.email, row.email_work, row.email_home]) keepOldest(index.byEmail, normEmail(email), row);
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
  const email = normEmail(candidate.email);
  if (email) {
    const byEmail = index.byEmail.get(email);
    if (byEmail) return byEmail;
  }
  const key = nameKey(candidate as any);
  return key ? index.byName.get(key) : undefined;
}

/** Une valeur importée vide n'efface jamais ce que la fiche porte déjà. */
export function nonEmptyFields<T extends Record<string, any>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => !(v === '' || v === null || v === undefined)),
  ) as Partial<T>;
}
