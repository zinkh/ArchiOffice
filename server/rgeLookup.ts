// ── Qualifications RGE par SIRET (données ouvertes de l'ADEME) ──────────────
// L'ADEME publie la liste des entreprises « Reconnu Garant de l'Environnement »
// avec, pour chacune, l'organisme qui a délivré la qualification (Qualibat,
// Qualifelec, Qualit'EnR...), son code et ses dates. C'est une base ouverte,
// consultable sans habilitation, contrairement à l'API Entreprise.
//
// Elle ne couvre QUE les qualifications RGE : une entreprise qualifiée
// Qualibat dans un domaine sans label environnemental n'y figure pas. Une
// réponse vide ne veut donc jamais dire « non qualifiée », seulement « pas de
// qualification RGE connue » ; l'écran le dit tel quel.
//
// Le nom du jeu de données et de ses colonnes est lu tolérant (alias, casse) :
// il a changé de nom par le passé et n'a pas pu être vérifié depuis l'environnement
// de développement, où le réseau est filtré. `ADEME_RGE_DATASET` permet de le
// corriger sans republier.
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  normaliserSiret, parseDateIso, siretValide,
  type OrganismeQualification, type QualificationImportee,
} from '../src/lib/qualifications';

export type RgeQualification = QualificationImportee;

export class RgeUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'RgeUnavailableError'; }
}

const DEFAULT_DATASET = 'liste-des-entreprises-rge-2';
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 500;
const PAGE_SIZE = 500;
/** Une requête groupée porte au plus ce nombre de SIRET (longueur d'URL). */
export const MAX_SIRETS_PAR_REQUETE = 25;

const cache = new Map<string, { expiresAt: number; data: RgeQualification[] }>();

export function resetRgeCache() { cache.clear(); }

function datasetUrl(): string {
  const id = (process.env.ADEME_RGE_DATASET || DEFAULT_DATASET).replace(/[^a-zA-Z0-9_-]/g, '');
  return `https://data.ademe.fr/data-fair/api/v1/datasets/${id}/lines`;
}

const lire = (row: any, ...cles: string[]): string => {
  for (const cle of cles) {
    const v = row?.[cle];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
};

export function organismeDepuisAdeme(valeur: string): OrganismeQualification {
  const v = valeur.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (v.includes('qualibat')) return 'qualibat';
  if (v.includes('qualifelec')) return 'qualifelec';
  if (v.includes('qualit')) return 'qualit_enr';
  if (v.includes('certibat')) return 'certibat';
  return 'rge';
}

/**
 * Regroupe les lignes brutes d'UNE entreprise. Le jeu de données porte une
 * ligne par domaine de travaux : une même qualification (même organisme, même
 * code) y revient autant de fois qu'elle couvre de domaines.
 */
export function regrouperQualifications(lignes: any[]): RgeQualification[] {
  const groupes = new Map<string, RgeQualification & { domainesSet: Set<string> }>();
  for (const row of lignes) {
    const organisme = organismeDepuisAdeme(lire(row, 'organisme', 'nom_organisme'));
    const libelle = lire(row, 'nom_qualification', 'qualification') || null;
    const reference = lire(row, 'code_qualification', 'code', 'nom_certificat') || libelle || '';
    const cle = `${organisme}|${reference}`;
    const domaine = lire(row, 'domaine', 'meta_domaine');
    const debut = parseDateIso(lire(row, 'date_debut', 'lien_date_debut', 'date_debut_validite'));
    const fin = parseDateIso(lire(row, 'date_fin', 'lien_date_fin', 'date_fin_validite'));
    const courant = groupes.get(cle);
    if (!courant) {
      groupes.set(cle, {
        organisme, reference: reference.slice(0, 100), libelle, domaines: null,
        date_debut: debut, date_fin: fin, domainesSet: new Set(domaine ? [domaine] : []),
      });
      continue;
    }
    if (domaine) courant.domainesSet.add(domaine);
    if (debut && (!courant.date_debut || debut < courant.date_debut)) courant.date_debut = debut;
    if (fin && (!courant.date_fin || fin > courant.date_fin)) courant.date_fin = fin;
  }
  return [...groupes.values()].map(({ domainesSet, ...q }) => ({
    ...q,
    domaines: domainesSet.size ? [...domainesSet].join(', ').slice(0, 500) : null,
  }));
}

async function interroger(sirets: string[], fetchFn: typeof fetchWithTimeout): Promise<Map<string, any[]>> {
  const requete = sirets.map(s => `"${s}"`).join(' OR ');
  const url = `${datasetUrl()}?size=${PAGE_SIZE}&qs=${encodeURIComponent(`siret:(${requete})`)}`;
  let reponse: Response;
  try {
    reponse = await fetchFn(url, { headers: { Accept: 'application/json' } }, TIMEOUT_MS);
  } catch {
    throw new RgeUnavailableError("La base RGE de l'ADEME est injoignable.");
  }
  if (!reponse.ok) throw new RgeUnavailableError(`La base RGE de l'ADEME a répondu ${reponse.status}.`);
  const json: any = await reponse.json().catch(() => null);
  const lignes: any[] = Array.isArray(json?.results) ? json.results : [];
  const parSiret = new Map<string, any[]>();
  for (const row of lignes) {
    const siret = normaliserSiret(lire(row, 'siret'));
    if (siret) parSiret.set(siret, [...(parSiret.get(siret) || []), row]);
  }
  return parSiret;
}

/**
 * Qualifications RGE connues pour chaque SIRET demandé (une entrée, éventuellement
 * vide, par SIRET valide). Résultats gardés six heures : la liste ne bouge pas à
 * l'échelle d'une session et chaque recherche d'entreprises la rappelle.
 */
export async function qualificationsRgeParSiret(
  sirets: string[],
  fetchFn: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<Map<string, RgeQualification[]>> {
  const demandes = [...new Set(sirets.map(normaliserSiret))].filter(siretValide);
  const resultat = new Map<string, RgeQualification[]>();
  const aInterroger: string[] = [];
  const now = Date.now();
  for (const siret of demandes) {
    const hit = cache.get(siret);
    if (hit && hit.expiresAt > now) resultat.set(siret, hit.data);
    else aInterroger.push(siret);
  }
  for (let i = 0; i < aInterroger.length; i += MAX_SIRETS_PAR_REQUETE) {
    const lot = aInterroger.slice(i, i + MAX_SIRETS_PAR_REQUETE);
    const lignes = await interroger(lot, fetchFn);
    for (const siret of lot) {
      const data = regrouperQualifications(lignes.get(siret) || []);
      resultat.set(siret, data);
      cache.set(siret, { expiresAt: now + CACHE_TTL_MS, data });
    }
  }
  while (cache.size > CACHE_MAX) {
    const plusAncien = cache.keys().next().value;
    if (plusAncien === undefined) break;
    cache.delete(plusAncien);
  }
  return resultat;
}
