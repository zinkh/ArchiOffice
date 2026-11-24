// Briques pures de la synchronisation CardDAV (lecture de la réponse du serveur, adresses des
// vCards, décision d'importer ou d'envoyer), sorties de la route pour être testées seules.
import { XMLParser } from 'fast-xml-parser';

export interface DavCard {
  /** Adresse de la vCard telle que le serveur la donne (vide si la réponse n'était pas du XML). */
  href: string;
  /** ETag avec ses guillemets, tel quel : c'est ce qu'il faut renvoyer dans `If-Match`. */
  etag: string;
  vcard: string;
  /** Dernière modification annoncée par le serveur (ms), `null` si absente ou illisible. */
  modified: number | null;
}

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
  isArray: name => name === 'response' || name === 'propstat',
});

const text = (v: any): string =>
  typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v['#text'] === 'string' ? v['#text'] : '');

/**
 * Cartes d'une réponse PROPFIND (multistatus). Une réponse qui n'est pas du XML (un serveur de
 * test, ou une vCard brute) est lue comme avant : chaque bloc BEGIN:VCARD, sans adresse.
 */
export function parseCardMultistatus(xml: string): DavCard[] {
  const cards: DavCard[] = [];
  if (/<[A-Za-z0-9_-]*:?multistatus/i.test(xml)) {
    try {
      const responses: any[] = xmlParser.parse(xml)?.multistatus?.response ?? [];
      for (const r of responses) {
        let etag = '';
        let vcard = '';
        let modified = '';
        for (const ps of r?.propstat ?? []) {
          const prop = ps?.prop ?? {};
          etag = etag || text(prop.getetag).trim();
          vcard = vcard || text(prop['address-data']);
          modified = modified || text(prop.getlastmodified).trim();
        }
        if (!vcard.trim()) continue;
        const ms = modified ? Date.parse(modified) : NaN;
        cards.push({ href: text(r.href).trim(), etag, vcard: vcard.trim(), modified: Number.isNaN(ms) ? null : ms });
      }
    } catch {
      // XML illisible : on retombe sur la recherche des blocs vCard ci-dessous.
    }
  }
  if (cards.length === 0) {
    for (const vcard of xml.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || []) {
      cards.push({ href: '', etag: '', vcard, modified: null });
    }
  }
  return cards;
}

/** Adresse du carnet avec sa barre finale : c'est le préfixe de toutes les vCards qu'il contient. */
export function collectionPrefix(url: string): string {
  const u = new URL(url);
  u.hash = '';
  u.search = '';
  return u.toString().endsWith('/') ? u.toString() : `${u.toString()}/`;
}

/**
 * Adresse absolue d'une vCard, ou `null` si elle sort du carnet choisi (autre serveur, autre
 * dossier). Un serveur ne peut donc pas faire écrire ailleurs que dans le carnet validé.
 */
export function resolveCardHref(href: string | null | undefined, prefix: string): string | null {
  if (!href) return null;
  try {
    const abs = new URL(href, prefix).toString();
    return abs.startsWith(prefix) && abs.length > prefix.length ? abs : null;
  } catch {
    return null;
  }
}

export type PullDecision = 'skip_unchanged' | 'pull' | 'local_wins' | 'conflict';

export interface PullFacts {
  /** La fiche est déjà reliée à CETTE vCard (adresse retrouvée dans le carnet). */
  linked: boolean;
  /** La catégorie de la fiche est envoyée : sans cela une modification locale n'a rien à protéger. */
  pushEnabled: boolean;
  localEtag?: string | null;
  remoteEtag?: string | null;
  /** Dernière modification locale et dernier échange, en ms. */
  localUpdatedAt: number;
  syncedAt: number | null;
  remoteModified: number | null;
}

/**
 * Que faire d'une vCard rencontrée à l'import quand sa fiche existe déjà ?
 * - inchangée depuis le dernier échange : rien ;
 * - changée côté serveur seulement : on l'importe (comportement d'avant) ;
 * - changée des deux côtés : la plus récente l'emporte ; sans date côté serveur on ne tranche
 *   pas (`conflict`) et rien n'est écrasé, ni d'un côté ni de l'autre.
 */
export function decidePull(f: PullFacts): PullDecision {
  if (!f.linked) return 'pull';
  const remoteChanged = !f.localEtag || !f.remoteEtag || f.localEtag !== f.remoteEtag;
  if (!remoteChanged) return 'skip_unchanged';
  const localChanged = f.pushEnabled && f.syncedAt != null && f.localUpdatedAt > f.syncedAt;
  if (!localChanged) return 'pull';
  if (f.remoteModified == null) return 'conflict';
  return f.remoteModified > f.localUpdatedAt ? 'pull' : 'local_wins';
}
