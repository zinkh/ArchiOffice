// Connecteur TED (Tenders Electronic Daily, Journal officiel de l'UE) pour la
// veille des appels d'offres : interroge l'API de recherche TED v3 (publique,
// sans clé) et produit des lignes tender_rss_matches au même format que le
// connecteur BOAMP (server/tenderBoampConnector.ts).
//
// Comme pour BOAMP, les noms de champs et la syntaxe de requête experte ne
// sont pas vérifiables hors ligne : les critères sont poussés à l'API dans
// une première tentative, puis dégradés (jeu de champs minimal) si l'API
// refuse la requête, le filtrage étant de toute façon rejoué localement sur
// les champs disponibles.
import axios from 'axios';
import { randomUUID } from 'node:crypto';

export const TED_API_URL = 'https://api.ted.europa.eu/v3/notices/search';

const FETCH_TIMEOUT_MS = 20000;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export interface TedSourceConfig {
  /** Pays de l'acheteur, ISO 3166-1 alpha-3 (défaut : FRA). Vide = tous. */
  pays: string[];
  /** Codes NUTS du lieu d'exécution (FRF = Grand Est, FRF31 = Meurthe-et-Moselle). Vide = tous. */
  nuts: string[];
  /** Codes CPV à 8 chiffres ; un code court est complété par des zéros (712 → 71200000). Vide = tous. */
  cpv: string[];
  /** Avis de marché uniquement (form-type competition), sans résultats ni modifications. */
  avis_initiaux_seulement: boolean;
  /** Fenêtre glissante de publication, en jours (1 à 90, défaut : 7). */
  jours_recents: number;
}

export const DEFAULT_TED_CONFIG: TedSourceConfig = {
  pays: ['FRA'],
  nuts: [],
  cpv: [],
  avis_initiaux_seulement: true,
  jours_recents: 7,
};

/** Préréglage « Architecture et maîtrise d'œuvre » proposé dans l'interface. */
export const TED_CPV_ARCHITECTURE = [
  '71200000', '71210000', '71220000', '71221000', '71222000', '71223000', '71230000', '71240000', '71250000',
  '71300000', '71310000', '71400000', '71410000', '71420000',
];

export function normalizeTedConfig(raw: unknown): TedSourceConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim().toUpperCase()).filter(Boolean) : []);
  const pays = [...new Set(list(r.pays).filter(p => /^[A-Z]{3}$/.test(p)))];
  const nuts = [...new Set(list(r.nuts).filter(n => /^[A-Z]{2}[A-Z0-9]{0,3}$/.test(n)))];
  const cpv = [...new Set(list(r.cpv).filter(c => /^\d{2,8}$/.test(c)).map(c => c.padEnd(8, '0')))];
  const jours = Number(r.jours_recents);
  return {
    pays: 'pays' in r ? pays : [...DEFAULT_TED_CONFIG.pays],
    nuts,
    cpv,
    avis_initiaux_seulement: r.avis_initiaux_seulement !== false,
    jours_recents: Number.isFinite(jours) && jours >= 1 && jours <= 90 ? Math.floor(jours) : DEFAULT_TED_CONFIG.jours_recents,
  };
}

function yyyymmddDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Requête experte TED. `full=false` ne garde que la date et le pays (repli). */
export function buildTedQuery(config: TedSourceConfig, opts: { full?: boolean; now?: Date } = {}): string {
  const clauses = [`publication-date >= ${yyyymmddDaysAgo(config.jours_recents, opts.now)}`];
  if (config.pays.length) clauses.push(`buyer-country IN (${config.pays.join(' ')})`);
  if (opts.full !== false) {
    if (config.nuts.length) clauses.push(`place-of-performance IN (${config.nuts.join(' ')})`);
    if (config.cpv.length) clauses.push(`classification-cpv IN (${config.cpv.join(' ')})`);
    if (config.avis_initiaux_seulement) clauses.push('form-type = competition');
  }
  return clauses.join(' AND ');
}

export const TED_FIELDS_FULL = [
  'publication-number', 'notice-title', 'buyer-name', 'buyer-country', 'publication-date',
  'deadline-receipt-tender-date-lot', 'place-of-performance', 'classification-cpv',
  'notice-type', 'form-type', 'procedure-type', 'estimated-value-lot', 'links',
];
export const TED_FIELDS_MINIMAL = ['publication-number', 'notice-title', 'buyer-name', 'publication-date', 'links'];

// ── Lecture défensive d'un avis ──────────────────────────────────────────────

export type TedNotice = Record<string, unknown>;

/** Valeur multilingue TED ({ fra: "...", eng: "..." } ou { fra: ["..."] }) → texte, français d'abord. */
export function pickLang(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const v of value) { const s = pickLang(v); if (s) return s; }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['fra', 'FRA', 'fr', 'eng', 'ENG', 'en']) {
      if (key in obj) { const s = pickLang(obj[key]); if (s) return s; }
    }
    for (const v of Object.values(obj)) { const s = pickLang(v); if (s) return s; }
  }
  return null;
}

function asStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(v => asStringList(v));
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(v => asStringList(v));
  return [];
}

function isoDatePart(value: unknown): string | null {
  const s = pickLang(value);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoDateTime(value: unknown): string | null {
  const day = isoDatePart(value);
  return day ? `${day}T00:00:00.000Z` : null;
}

function firstAmount(value: unknown): number | null {
  for (const v of Array.isArray(value) ? value : [value]) {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function noticeLink(notice: TedNotice): string | null {
  const links = notice.links as Record<string, unknown> | undefined;
  const html = links?.html as Record<string, unknown> | undefined;
  if (html) {
    for (const key of ['FRA', 'fra', 'ENG', 'eng']) {
      const url = html[key];
      if (typeof url === 'string' && url) return url;
    }
    const first = Object.values(html).find(v => typeof v === 'string' && v);
    if (typeof first === 'string') return first;
  }
  const pub = pickLang(notice['publication-number']);
  return pub ? `https://ted.europa.eu/fr/notice/-/detail/${encodeURIComponent(pub)}` : null;
}

export function cpvOf(notice: TedNotice): string[] {
  return asStringList(notice['classification-cpv']).map(c => c.replace(/\D/g, '')).filter(c => c.length >= 2);
}

export function placesOf(notice: TedNotice): string[] {
  return asStringList(notice['place-of-performance']).map(p => p.toUpperCase());
}

export function isCompetitionNotice(notice: TedNotice): boolean {
  const formType = pickLang(notice['form-type']);
  if (formType) return /competition/i.test(formType);
  const noticeType = pickLang(notice['notice-type']);
  // cn-* = contract notice ; can-* = award ; pin-* = prior information ; corr = corrigendum.
  if (noticeType) return /^cn-/i.test(noticeType);
  return true;
}

export function recordMatchesTedConfig(notice: TedNotice, config: TedSourceConfig): boolean {
  if (config.pays.length) {
    const countries = asStringList(notice['buyer-country']).map(c => c.toUpperCase());
    if (countries.length && !countries.some(c => config.pays.includes(c))) return false;
  }
  if (config.nuts.length) {
    const places = placesOf(notice);
    if (places.length && !places.some(p => config.nuts.some(n => p.startsWith(n)))) return false;
  }
  if (config.cpv.length) {
    const prefixes = config.cpv.map(c => c.replace(/0+$/, '')).map(c => (c.length < 2 ? c.padEnd(2, '0') : c));
    const codes = cpvOf(notice);
    if (codes.length && !codes.some(code => prefixes.some(prefix => code.startsWith(prefix)))) return false;
  }
  if (config.avis_initiaux_seulement && !isCompetitionNotice(notice)) return false;
  return true;
}

export interface TedMatchRow {
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

export function mapTedNotice(notice: TedNotice, source: { id: string; tenant_id: string }): TedMatchRow {
  const pub = pickLang(notice['publication-number']);
  const link = noticeLink(notice);
  const acheteur = pickLang(notice['buyer-name']);
  const pays = asStringList(notice['buyer-country']).join(', ');
  const places = placesOf(notice);
  const cpv = cpvOf(notice);
  const dateLimite = isoDatePart(notice['deadline-receipt-tender-date-lot']);
  const formType = pickLang(notice['form-type']) || pickLang(notice['notice-type']);
  const procedure = pickLang(notice['procedure-type']);
  const montant = firstAmount(notice['estimated-value-lot']);

  const lines = [
    acheteur ? `Acheteur : ${acheteur}` : null,
    pays ? `Pays : ${pays}` : null,
    formType ? `Type d'avis : ${formType}` : null,
    procedure ? `Procédure : ${procedure}` : null,
    cpv.length ? `CPV : ${cpv.join(', ')}` : null,
    places.length ? `Lieu d'exécution (NUTS) : ${places.join(', ')}` : null,
    montant ? `Valeur estimée : ${montant.toLocaleString('fr-FR')} €` : null,
    dateLimite ? `Date limite de réponse : ${dateLimite.split('-').reverse().join('/')}` : null,
    pub ? `Référence TED : ${pub}` : null,
  ].filter(Boolean) as string[];

  return {
    id: randomUUID(),
    tenant_id: source.tenant_id,
    source_id: source.id,
    guid: pub || link || randomUUID(),
    title: pickLang(notice['notice-title']) || '(sans titre)',
    link,
    description: lines.length ? lines.join('\n') : null,
    pub_date: isoDateTime(notice['publication-date']),
    status: 'new',
    ville_execution: places.length ? `NUTS ${places.join(', ')}` : null,
    pouvoir_adjudicateur: acheteur,
    montant_travaux: montant,
    date_limite_reponse: dateLimite,
  };
}

export function tedKeywordText(notice: TedNotice): string {
  return [pickLang(notice['notice-title']), pickLang(notice['buyer-name']), cpvOf(notice).join(' ')].filter(Boolean).join(' ');
}

interface TedPage {
  totalNoticeCount?: number;
  notices?: TedNotice[];
}

async function fetchPage(apiUrl: string, query: string, fields: string[], page: number): Promise<TedPage> {
  const response = await axios.post<TedPage>(apiUrl, { query, fields, page, limit: PAGE_SIZE }, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'ArchiOffice tender watch' },
  });
  return response.data || {};
}

function tedErrorMessage(e: any): string {
  const body = e?.response?.data;
  const detail = body?.message || body?.error || (typeof body === 'string' ? body.slice(0, 200) : null);
  const status = e?.response?.status;
  return status ? `TED API HTTP ${status}${detail ? ` : ${detail}` : ''}` : (e?.message || 'TED API : erreur inconnue');
}

export interface TedFetchResult {
  notices: TedNotice[];
  apiTotal: number | null;
  /** Vrai si l'API a refusé le jeu de champs complet (champs minimaux, filtres locaux partiels). */
  degraded: boolean;
}

export async function fetchTedNotices(
  config: TedSourceConfig,
  opts: { apiUrl?: string; maxPages?: number; now?: Date } = {}
): Promise<TedFetchResult> {
  const apiUrl = opts.apiUrl || TED_API_URL;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const query = buildTedQuery(config, { full: true, now: opts.now });

  let fields = TED_FIELDS_FULL;
  let degraded = false;
  let first: TedPage;
  try {
    first = await fetchPage(apiUrl, query, fields, 1);
  } catch (e: any) {
    if (e?.response?.status !== 400) throw new Error(tedErrorMessage(e));
    degraded = true;
    fields = TED_FIELDS_MINIMAL;
    try {
      first = await fetchPage(apiUrl, query, fields, 1);
    } catch (e2: any) {
      throw new Error(tedErrorMessage(e2));
    }
  }

  const apiTotal = typeof first.totalNoticeCount === 'number' ? first.totalNoticeCount : null;
  const notices: TedNotice[] = [...(first.notices || [])];
  let page = 1;
  while (page < maxPages && (first.notices || []).length === PAGE_SIZE && (apiTotal === null || notices.length < apiTotal)) {
    page += 1;
    let next: TedPage;
    try {
      next = await fetchPage(apiUrl, query, fields, page);
    } catch (e: any) {
      throw new Error(tedErrorMessage(e));
    }
    const results = next.notices || [];
    notices.push(...results);
    if (results.length < PAGE_SIZE) break;
  }

  return { notices: notices.filter(n => recordMatchesTedConfig(n, config)), apiTotal, degraded };
}
