// Connecteur BOAMP pour la veille des appels d'offres : interroge l'API
// ouverte OpenDataSoft du BOAMP (jeu de données "boamp", alimenté plusieurs
// fois par jour, sans clé d'API) et produit des lignes tender_rss_matches au
// même format que le sondage RSS (server/tenderRssPoller.ts), mais avec des
// champs déjà structurés : plus besoin de l'extraction heuristique de
// server/tenderFieldExtractor.ts.
//
// Les noms de champs du jeu de données ne sont pas contractuels côté
// OpenDataSoft : ce module reste volontairement défensif. Seuls les filtres
// les plus sûrs (date de parution, code département) sont poussés côté API ;
// le reste (type de marché, avis initiaux, mots-clés) est filtré ici, et
// toute requête refusée (HTTP 400, typiquement un nom de champ inconnu) est
// retentée avec le filtre minimal avant d'abandonner.
import axios from 'axios';
import { randomUUID } from 'node:crypto';

export const BOAMP_API_URL = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';

const FETCH_TIMEOUT_MS = 20000;
// Limite maximale par page de l'API Explore v2.1.
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export const BOAMP_TYPES_MARCHE = ['TRAVAUX', 'SERVICES', 'FOURNITURES'] as const;
export type BoampTypeMarche = typeof BOAMP_TYPES_MARCHE[number];

export interface BoampSourceConfig {
  /** Codes département ("54", "2A", "971"). Vide = toute la France. */
  departements: string[];
  /** Vide = tous les types. */
  types_marche: BoampTypeMarche[];
  /** Exclut avis d'attribution, rectificatifs et annulations (défaut : true). */
  avis_initiaux_seulement: boolean;
  /** Fenêtre glissante de parution, en jours (1 à 90, défaut : 7). */
  jours_recents: number;
}

export const DEFAULT_BOAMP_CONFIG: BoampSourceConfig = {
  departements: [],
  types_marche: [],
  avis_initiaux_seulement: true,
  jours_recents: 7,
};

export function normalizeBoampConfig(raw: unknown): BoampSourceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const departements = Array.isArray(r.departements)
    ? [...new Set(r.departements.map(d => String(d).trim().toUpperCase()).filter(d => /^(\d{2,3}|2A|2B)$/.test(d)))]
    : [];
  const types = Array.isArray(r.types_marche)
    ? [...new Set(r.types_marche.map(t => String(t).trim().toUpperCase()).filter((t): t is BoampTypeMarche => (BOAMP_TYPES_MARCHE as readonly string[]).includes(t)))]
    : [];
  const jours = Number(r.jours_recents);
  return {
    departements,
    types_marche: types,
    avis_initiaux_seulement: r.avis_initiaux_seulement !== false,
    jours_recents: Number.isFinite(jours) && jours >= 1 && jours <= 90 ? Math.floor(jours) : DEFAULT_BOAMP_CONFIG.jours_recents,
  };
}

function isoDateDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Clause ODSQL `where` : date de parution (toujours) + départements (si demandés). */
export function buildBoampWhere(config: BoampSourceConfig, opts: { withDepartements?: boolean; now?: Date } = {}): string {
  const clauses = [`dateparution >= date'${isoDateDaysAgo(config.jours_recents, opts.now)}'`];
  if (opts.withDepartements !== false && config.departements.length) {
    clauses.push(`code_departement in (${config.departements.map(d => `"${d}"`).join(', ')})`);
  }
  return clauses.join(' and ');
}

// ── Lecture défensive d'un enregistrement ────────────────────────────────────

export type BoampRecord = Record<string, unknown>;

function asStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    // Certaines exports sérialisent les listes en JSON ("[\"54\"]") ou en CSV.
    const s = value.trim();
    if (s.startsWith('[')) {
      try { return asStringList(JSON.parse(s)); } catch { /* fallthrough */ }
    }
    return s.split(/[,;]/).map(v => v.trim()).filter(Boolean);
  }
  return [String(value)];
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function isoDatePart(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoDateTime(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parcours récursif borné : première valeur dont la clé matche `keyRe`. */
function findByKey(obj: unknown, keyRe: RegExp, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keyRe.test(k)) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const found = findByKey(v, keyRe, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function parseDonnees(record: BoampRecord): unknown {
  const raw = record.donnees;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

export function typeMarcheOf(record: BoampRecord): string | null {
  const facette = asString(record.type_marche_facette);
  if (facette) return facette.toUpperCase();
  const list = asStringList(record.type_marche);
  return list.length ? list[0].toUpperCase() : null;
}

/** Vrai pour un avis initial (ni attribution, ni rectificatif, ni annulation, ni résultat). */
export function isAvisInitial(record: BoampRecord): boolean {
  const haystack = [record.nature, record.nature_libelle, record.nature_categorise, record.type_avis, record.famille, record.famille_libelle]
    .map(v => asStringList(v).join(' '))
    .join(' ')
    .toLowerCase();
  return !/(attribution|rectificatif|annulation|r[ée]sultat)/.test(haystack);
}

export function villeOf(record: BoampRecord): string | null {
  const donnees = parseDonnees(record);
  const lieu = findByKey(donnees, /lieu.?exec/i);
  if (typeof lieu === 'string') return lieu.trim() || null;
  if (lieu && typeof lieu === 'object') {
    const ville = findByKey(lieu, /^ville$|^commune$|^localite$/i);
    if (typeof ville === 'string' && ville.trim()) return ville.trim();
    const adresse = findByKey(lieu, /^adresse$/i);
    if (typeof adresse === 'string' && adresse.trim()) return adresse.trim();
  }
  const departements = asStringList(record.code_departement);
  return departements.length ? `Dépt. ${departements.join(', ')}` : null;
}

export interface BoampMatchRow {
  id: string;
  tenant_id: string;
  source_id: string;
  guid: string;
  title: string;
  link: string | null;
  description: string | null;
  pub_date: string | null;
  status: 'new';
  ville_execution: string | null;
  pouvoir_adjudicateur: string | null;
  montant_travaux: number | null;
  date_limite_reponse: string | null;
}

export function mapBoampRecord(record: BoampRecord, source: { id: string; tenant_id: string }): BoampMatchRow {
  const idweb = asString(record.idweb) || asString(record.id);
  const link = asString(record.url_avis) || (idweb ? `https://www.boamp.fr/pages/avis/?q=idweb:%22${encodeURIComponent(idweb)}%22` : null);
  const acheteur = asString(record.nomacheteur);
  const dateLimite = isoDatePart(record.datelimitereponse);
  const departements = asStringList(record.code_departement);
  const descripteurs = asStringList(record.descripteur_libelle);
  const typeMarche = typeMarcheOf(record);
  const procedure = asString(record.procedure_libelle) || asString(record.procedure_categorise);
  const nature = asString(record.nature_libelle) || asString(record.type_avis) || asString(record.nature);

  const lines = [
    acheteur ? `Acheteur : ${acheteur}` : null,
    typeMarche ? `Type de marché : ${typeMarche.charAt(0) + typeMarche.slice(1).toLowerCase()}` : null,
    procedure ? `Procédure : ${procedure}` : null,
    nature ? `Nature de l'avis : ${nature}` : null,
    departements.length ? `Département(s) : ${departements.join(', ')}` : null,
    descripteurs.length ? `Descripteurs : ${descripteurs.join(', ')}` : null,
    dateLimite ? `Date limite de réponse : ${dateLimite.split('-').reverse().join('/')}` : null,
    idweb ? `Référence BOAMP : ${idweb}` : null,
  ].filter(Boolean) as string[];

  return {
    id: randomUUID(),
    tenant_id: source.tenant_id,
    source_id: source.id,
    guid: idweb || link || randomUUID(),
    title: asString(record.objet) || '(sans objet)',
    link,
    description: lines.length ? lines.join('\n') : null,
    pub_date: isoDateTime(record.dateparution),
    status: 'new',
    ville_execution: villeOf(record),
    pouvoir_adjudicateur: acheteur,
    montant_travaux: null,
    date_limite_reponse: dateLimite,
  };
}

/** Texte sur lequel s'appliquent les mots-clés inclus/exclus de la source. */
export function boampKeywordText(record: BoampRecord): string {
  return [record.objet, record.nomacheteur, asStringList(record.descripteur_libelle).join(' ')]
    .map(v => asString(v) || '')
    .join(' ');
}

/** Filtres appliqués côté serveur ArchiOffice (après l'API). */
export function recordMatchesConfig(record: BoampRecord, config: BoampSourceConfig): boolean {
  if (config.departements.length) {
    const deps = asStringList(record.code_departement).map(d => d.toUpperCase());
    if (!deps.some(d => config.departements.includes(d))) return false;
  }
  if (config.types_marche.length) {
    const type = typeMarcheOf(record);
    if (!type || !config.types_marche.includes(type as BoampTypeMarche)) return false;
  }
  if (config.avis_initiaux_seulement && !isAvisInitial(record)) return false;
  return true;
}

interface OdsPage {
  total_count?: number;
  results?: BoampRecord[];
}

async function fetchPage(apiUrl: string, where: string, offset: number): Promise<OdsPage> {
  const response = await axios.get<OdsPage>(apiUrl, {
    timeout: FETCH_TIMEOUT_MS,
    params: { where, order_by: 'dateparution desc', limit: PAGE_SIZE, offset },
    headers: { Accept: 'application/json', 'User-Agent': 'ArchiOffice tender watch' },
  });
  return response.data || {};
}

function odsErrorMessage(e: any): string {
  const body = e?.response?.data;
  const detail = body?.message || body?.error_code || body?.error;
  const status = e?.response?.status;
  return status ? `BOAMP API HTTP ${status}${detail ? ` : ${detail}` : ''}` : (e?.message || 'BOAMP API : erreur inconnue');
}

export interface BoampFetchResult {
  records: BoampRecord[];
  /** Total annoncé par l'API pour la clause `where` retenue (avant filtres locaux). */
  apiTotal: number | null;
  /** Vrai si le filtre départements a dû être retiré de la requête API (filtré localement). */
  degraded: boolean;
}

/**
 * Récupère les avis récents correspondant à la configuration. Le filtre
 * départements est d'abord poussé à l'API ; s'il est refusé (400), on
 * retombe sur le seul filtre de date et on filtre localement.
 */
export async function fetchBoampRecords(
  config: BoampSourceConfig,
  opts: { apiUrl?: string; maxPages?: number; now?: Date } = {}
): Promise<BoampFetchResult> {
  const apiUrl = opts.apiUrl || BOAMP_API_URL;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  let where = buildBoampWhere(config, { withDepartements: true, now: opts.now });
  let degraded = false;
  let first: OdsPage;
  try {
    first = await fetchPage(apiUrl, where, 0);
  } catch (e: any) {
    if (e?.response?.status === 400 && config.departements.length) {
      degraded = true;
      where = buildBoampWhere(config, { withDepartements: false, now: opts.now });
      try {
        first = await fetchPage(apiUrl, where, 0);
      } catch (e2: any) {
        throw new Error(odsErrorMessage(e2));
      }
    } else {
      throw new Error(odsErrorMessage(e));
    }
  }

  const apiTotal = typeof first.total_count === 'number' ? first.total_count : null;
  const records: BoampRecord[] = [...(first.results || [])];
  let page = 1;
  while (page < maxPages && (first.results || []).length === PAGE_SIZE && (apiTotal === null || records.length < apiTotal)) {
    let next: OdsPage;
    try {
      next = await fetchPage(apiUrl, where, page * PAGE_SIZE);
    } catch (e: any) {
      throw new Error(odsErrorMessage(e));
    }
    const results = next.results || [];
    records.push(...results);
    if (results.length < PAGE_SIZE) break;
    page += 1;
  }

  return { records: records.filter(r => recordMatchesConfig(r, config)), apiTotal, degraded };
}
