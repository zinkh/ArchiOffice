// Synchronisation CardDAV d'un cabinet : import du carnet vers les contacts, puis envoi des
// contacts des catégories choisies vers le carnet (Réglages > CardDAV). La route
// `POST /api/sync/carddav` (server/routes/contactSync.ts) ne fait que valider l'adresse et appeler ceci.
//
// Règles à ne pas défaire :
// - rien n'est envoyé tant qu'aucune catégorie n'est cochée (l'import n'est pas touché) ;
// - jamais d'écriture hors du carnet choisi : l'adresse d'une vCard est résolue contre lui
//   (`resolveCardHref`), un serveur ne peut pas rediriger l'envoi vers un autre hôte ;
// - jamais d'écrasement à l'aveugle : une mise à jour part avec `If-Match` (l'ETag courant), une
//   création avec `If-None-Match: *`, et un 412 est compté comme conflit, pas forcé ;
// - jamais de suppression, dans un sens comme dans l'autre ;
// - une instance sans la migration (migrate_carddav_push.sql) importe comme avant et n'envoie rien.
import { tenantScopedFrom } from './tenantScopedFrom';
import { selectAllPages } from './selectAllPages';
import { addToSyncIndex, buildSyncIndex, emailsFromGoogle, findExistingContact, nonEmptyFields, type SyncContactRow } from './contactSyncMatch';
import { phonesFromGoogle } from '../src/lib/contactPhones';
import { splitVcardValue, unescapeVcardText, vcardTypedValues } from './vcardTypedValues';
import { buildVcard } from './vcardBuild';
import { collectionPrefix, decidePull, parseCardMultistatus, resolveCardHref, type DavCard, type PullDecision } from './carddavSync';

/** Envois par synchronisation : au-delà, le reste attend la suivante (`pushRemaining`). */
export const CARDDAV_PUSH_LIMIT = 300;
const REQUEST_TIMEOUT_MS = 20_000;

const BASE_COLS = 'id, first_name, last_name, company_name, email, email_work, email_home, email_other, google_resource_name, is_personal, created_at';
const LINK_COLS = `${BASE_COLS}, carddav_href, carddav_etag, carddav_synced_at, updated_at, category`;

interface LinkedRow extends SyncContactRow {
  carddav_href?: string | null;
  carddav_etag?: string | null;
  carddav_synced_at?: string | null;
  updated_at?: string | null;
  category?: string | null;
}

export interface CardDavSyncResult {
  imported: number;
  updated: number;
  pushedCreated: number;
  pushedUpdated: number;
  /** Fiches ou vCards modifiées des deux côtés sans pouvoir trancher, ou refusées par le serveur (412) : rien n'est écrasé. */
  pushConflicts: number;
  pushFailed: number;
  /** Contacts qui attendent la prochaine synchronisation (plafond d'envois atteint). */
  pushRemaining: number;
  /** Des catégories sont cochées mais la migration n'est pas appliquée : rien n'a été envoyé. */
  pushUnavailable: boolean;
}

export class CardDavError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const ms = (v?: string | null): number => (v ? Date.parse(v) || 0 : 0);

async function loadPushCategories(supabaseAdmin: any, tenantId: string): Promise<Set<string>> {
  // Colonne absente (instance non migrée) ou aucun réglage : ensemble vide, rien n'est envoyé.
  const { data, error } = await supabaseAdmin
    .from('settings').select('carddav_sync_categories').eq('tenant_id', tenantId).maybeSingle();
  const list = !error && Array.isArray(data?.carddav_sync_categories) ? data.carddav_sync_categories : [];
  return new Set(list.filter((c: unknown): c is string => typeof c === 'string' && c.trim() !== ''));
}

const getField = (vcard: string, field: string): string => {
  const m = vcard.match(new RegExp(`(?:^|\\n)${field}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
};

export async function runCardDavSync(
  supabaseAdmin: any,
  tenantId: string,
  { url, username, password }: { url: string; username: string; password: string },
): Promise<CardDavSyncResult> {
  const prefix = collectionPrefix(url);
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  // PROPFIND : liste des vCards, avec leur adresse, leur ETag et leur date de modification.
  const propfindRes = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: authHeader, Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><d:getlastmodified/><card:address-data/></d:prop></d:propfind>',
  });
  if (!propfindRes.ok) {
    throw new CardDavError(400, `Erreur CardDAV ${propfindRes.status}: vérifiez l'URL et les identifiants`);
  }
  const cards = parseCardMultistatus(await propfindRes.text());

  const pushCategories = await loadPushCategories(supabaseAdmin, tenantId);

  // Toutes les fiches du cabinet, lues UNE fois. Sans les colonnes de lien (migration absente),
  // on relit les anciennes : l'import marche, l'envoi est désactivé.
  let linkSupported = true;
  let loaded = await selectAllPages<LinkedRow>(
    () => tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select(LINK_COLS) as any,
  );
  if (loaded.error) {
    linkSupported = false;
    loaded = await selectAllPages<LinkedRow>(
      () => tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select(BASE_COLS) as any,
    );
    if (loaded.error) throw loaded.error;
  }
  const index = buildSyncIndex(loaded.data);
  const byHref = new Map<string, LinkedRow>();
  for (const row of loaded.data) {
    const href = resolveCardHref(row.carddav_href, prefix);
    if (href && !row.is_personal) byHref.set(href, row);
  }

  const remote = new Map<string, DavCard>();
  const decisions = new Map<string, PullDecision>();
  let imported = 0;
  let updated = 0;

  for (const card of cards) {
    const vcard = card.vcard;
    const fullName = unescapeVcardText(getField(vcard, 'FN'));
    // Toutes les adresses et tous les numéros, avec leur type (travail, domicile, mobile...) :
    // rangés comme ceux de Google Contacts (voir vcardTypedValues.ts).
    const emails = emailsFromGoogle(vcardTypedValues(vcard, 'EMAIL'));
    const phones = phonesFromGoogle(vcardTypedValues(vcard, 'TEL'));
    const orgName = splitVcardValue(getField(vcard, 'ORG'))[0] || '';
    const nameParts = splitVcardValue(getField(vcard, 'N'));
    const lastName = nameParts[0] || '';
    const firstName = nameParts[1] || (fullName.split(' ')[0] || '');

    if (!fullName && !emails.email) continue;

    const href = resolveCardHref(card.href, prefix);
    if (href) remote.set(href, card);

    const fields = {
      first_name: firstName,
      // Une société n'a pas de nom de famille : son FN est celui de l'ORG, pas un nom de personne.
      last_name: lastName || (orgName && fullName === orgName ? '' : fullName),
      ...emails,
      ...phones,
      company_name: orgName,
    };
    const existing = (href && byHref.get(href)) || findExistingContact(index, fields);
    const now = new Date().toISOString();
    const link = linkSupported && href
      ? { carddav_href: href, carddav_etag: card.etag || null, carddav_synced_at: now }
      : {};

    if (existing) {
      const row = existing as LinkedRow;
      const decision = decidePull({
        linked: linkSupported && !!href && resolveCardHref(row.carddav_href, prefix) === href,
        pushEnabled: !!row.category && pushCategories.has(row.category),
        localEtag: row.carddav_etag,
        remoteEtag: card.etag,
        localUpdatedAt: ms(row.updated_at),
        syncedAt: row.carddav_synced_at ? ms(row.carddav_synced_at) : null,
        remoteModified: card.modified,
      });
      decisions.set(existing.id, decision);
      if (decision !== 'pull') continue;
      await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .update({ ...nonEmptyFields(fields), updated_at: now, ...link }).eq('id', existing.id);
      updated++;
    } else {
      const id = crypto.randomUUID();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .insert({ ...fields, updated_at: now, id, address: '', city: '', zip: '', state: '', country: '', ca_amount: 0, created_at: now, ...link });
      const created: LinkedRow = { id, ...fields, created_at: now, ...link };
      addToSyncIndex(index, created);
      if (href) byHref.set(href, created);
      imported++;
    }
  }

  const result: CardDavSyncResult = {
    imported, updated, pushedCreated: 0, pushedUpdated: 0, pushConflicts: 0, pushFailed: 0, pushRemaining: 0, pushUnavailable: false,
  };
  if (pushCategories.size === 0) return result;
  if (!linkSupported) return { ...result, pushUnavailable: true };

  // ── Envoi : ArchiOffice → carnet CardDAV ───────────────────────────────────────────────
  const { data: toPush } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
    .select('*')
    .in('category', [...pushCategories])
    // Un contact « Personnel » ne quitte jamais le cabinet par une synchronisation.
    .neq('is_personal', true);

  let budget = CARDDAV_PUSH_LIMIT;
  for (const contact of (toPush || []) as any[]) {
    try {
      const href = resolveCardHref(contact.carddav_href, prefix);
      const remoteCard = href ? remote.get(href) : undefined;
      const decision = decisions.get(contact.id);
      let target: string;
      const headers: Record<string, string> = { Authorization: authHeader, 'Content-Type': 'text/vcard; charset=utf-8' };
      const isCreate = !(href && remoteCard);

      if (href && remoteCard) {
        if (decision === 'conflict') { result.pushConflicts++; continue; }
        const pending = decision === 'local_wins'
          || (!!contact.carddav_synced_at && ms(contact.updated_at) > ms(contact.carddav_synced_at));
        if (!pending) continue;
        target = href;
        if (remoteCard.etag) headers['If-Match'] = remoteCard.etag;
      } else {
        // Jamais envoyée, ou supprimée du serveur depuis : (re)création.
        target = `${prefix}${encodeURIComponent(contact.id)}.vcf`;
        headers['If-None-Match'] = '*';
      }

      if (budget <= 0) { result.pushRemaining++; continue; }
      budget--;

      const putRes = await fetch(target, {
        method: 'PUT', headers, body: buildVcard(contact), redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (putRes.status === 412) { result.pushConflicts++; continue; }
      if (![200, 201, 204].includes(putRes.status)) { result.pushFailed++; continue; }

      await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .update({ carddav_href: target, carddav_etag: putRes.headers?.get?.('etag') || null, carddav_synced_at: new Date().toISOString() })
        .eq('id', contact.id);
      if (isCreate) result.pushedCreated++; else result.pushedUpdated++;
    } catch {
      // Un contact en échec n'interrompt pas les autres.
      result.pushFailed++;
    }
  }
  return result;
}
