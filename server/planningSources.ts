// Ce que le DPGF et le CCTP d'une opération apprennent au planning de chantier :
// pour chaque lot, ses chapitres avec leur montant et leurs principaux ouvrages
// (désignation, quantité, unité), et un extrait des prescriptions du CCTP (délais
// de séchage, mises en œuvre par phases, contraintes d'accès...). Le DPGF et le CCTP
// sont le même document (`dpgfs`) ; voir CLAUDE.md, « Le CCTP n'est pas un document séparé ».
// Pur : ne lit rien en base, testé dans tests/planningSources.test.ts.
import type { LotPlanifiable } from '../src/lib/planningChantier';

export interface SourceLot {
  lotId: string;
  /** Montant HT des ouvrages de base du lot, 0 si le DPGF n'est pas chiffré. */
  montantHt: number;
  chapitres: { numero: string; titre: string; montantHt: number; ouvrages: string[] }[];
  /** Prescriptions du CCTP (lot, chapitres, articles), tronquées. */
  cctp: string;
}

export interface SourcesPlanning {
  lots: SourceLot[];
  /** Bâtiments et phases du registre du document, s'il y en a. */
  batiments: string[];
  phases: string[];
  aDpgf: boolean;
  aCctp: boolean;
}

const MAX_CHAPITRES = 12;
const MAX_OUVRAGES = 6;
const MAX_CCTP_CHARS = 900;

const normal = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/^lot\s*/, '').replace(/^0+(?=\d)/, '');
const nombre = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const propre = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();

// ── Marchés ↔ lots ───────────────────────────────────────────────────────────
// Le numéro d'un marché ne suit pas toujours celui du lot (sur une affaire réelle :
// marché 09 « Peinture » pour le lot 07, marchés 10 et 11 pour le lot 09 CVC-plomberie,
// marché 12 « Électricité » pour le lot 10). Le rapprochement par numéro seul attachait
// donc la mauvaise entreprise et le mauvais montant : on compare les intitulés, le
// numéro identique ne faisant que départager.

export interface MarcheLigne {
  entreprise_nom?: string | null;
  lot_numero?: string | null;
  lot_titre?: string | null;
  montant_ht?: number | string | null;
  duree_mois?: number | string | null;
  statut?: string | null;
}

export interface MarcheDuLot { entreprises: string[]; montantHt: number | null; dureeMois: number | null }

const MOTS_VIDES = new Set(['des', 'les', 'aux', 'pour', 'sur', 'avec', 'dans', 'une', 'travaux', 'lot', 'ouvrages']);
const mots = (t: unknown): Set<string> => new Set(
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(m => m.length >= 3 && !MOTS_VIDES.has(m)),
);
const SEUIL_RAPPROCHEMENT = 0.5;

function scoreMarche(lot: LotPlanifiable, marche: MarcheLigne): number {
  const a = mots(lot.lot_title);
  const b = mots(marche.lot_titre);
  const memeNumero = normal(lot.lot_number) === normal(marche.lot_numero);
  // Sans intitulé à comparer, seul le numéro peut rapprocher.
  if (!a.size || !b.size) return memeNumero ? 1 : 0;
  const communs = [...a].filter(m => b.has(m)).length;
  return communs / Math.min(a.size, b.size) + (memeNumero ? 0.4 : 0);
}

/** Chaque marché va au lot qui lui ressemble le plus ; un marché sans lot est rendu à part (installation de chantier...). */
export function associerMarches(lots: LotPlanifiable[], marches: MarcheLigne[]): { parLot: Map<string, MarcheDuLot>; sansLot: MarcheLigne[] } {
  const brut = new Map<string, MarcheLigne[]>();
  const sansLot: MarcheLigne[] = [];
  for (const m of marches) {
    if (m.statut === 'resilie') continue;
    let meilleur: { lot: LotPlanifiable; score: number } | null = null;
    for (const lot of lots) {
      const score = scoreMarche(lot, m);
      if (score >= SEUIL_RAPPROCHEMENT && (!meilleur || score > meilleur.score)) meilleur = { lot, score };
    }
    if (!meilleur) { sansLot.push(m); continue; }
    brut.set(meilleur.lot.id, [...(brut.get(meilleur.lot.id) ?? []), m]);
  }
  const parLot = new Map<string, MarcheDuLot>();
  for (const [lotId, liste] of brut) {
    const montant = liste.reduce((n, m) => n + nombre(m.montant_ht), 0);
    const duree = Math.max(0, ...liste.map(m => nombre(m.duree_mois)));
    parLot.set(lotId, {
      entreprises: [...new Set(liste.map(m => propre(m.entreprise_nom)).filter(Boolean))],
      montantHt: montant > 0 ? Math.round(montant) : null,
      dureeMois: duree > 0 ? duree : null,
    });
  }
  return { parLot, sansLot };
}

const PLACEHOLDER = /^\s*(nouvel article|nouveau chapitre)\s*$/i;

/** Feuilles chiffrables en base (ni option, ni variante, ni pour mémoire, ni ligne vide par défaut), sous-articles compris. */
function ouvragesDe(lignes: any[], sortie: any[] = []): any[] {
  for (const l of lignes ?? []) {
    if (l?.cctpOnly) continue;
    if (Array.isArray(l?.children) && l.children.length) ouvragesDe(l.children, sortie);
    else if ((l?.type === 'ouvrage' || l?.type === undefined) && !PLACEHOLDER.test(String(l?.designation ?? ''))) {
      if ((l?.nature ?? 'base') === 'base' && !l?.pourMemoire) sortie.push(l);
    }
  }
  return sortie;
}

interface PosteChapitre { libelle: string; montant: number }

/** Les postes d'un chapitre, tels qu'on les lit dans le DPGF : un groupe (« Couverture métallique ») compte pour un, avec ses sous-articles. */
function postesDe(lignes: any[]): PosteChapitre[] {
  const postes: PosteChapitre[] = [];
  for (const l of lignes ?? []) {
    const feuilles = ouvragesDe([l]);
    if (!feuilles.length) continue;
    const nom = propre(l?.designation);
    const montant = feuilles.reduce((n, o) => n + nombre(o.prixTotal), 0);
    const groupe = Array.isArray(l?.children) && l.children.length > 0;
    const libelle = groupe
      ? `${nom} (${feuilles.length} poste${feuilles.length > 1 ? 's' : ''})`
      : `${nom}${nombre(l.quantite) > 0 ? ` (${nombre(l.quantite)}${propre(l.unite) ? ` ${propre(l.unite)}` : ''})` : ''}`;
    postes.push({ libelle: libelle.slice(0, 120), montant });
  }
  return postes;
}

/** Prescriptions CCTP portées par les articles, chacune précédée de l'ouvrage qu'elle décrit. */
function prescriptionsDes(lignes: any[], sortie: string[] = []): string[] {
  for (const l of lignes ?? []) {
    const texte = propre(l?.cctpDescription);
    if (texte) sortie.push(l?.designation && !PLACEHOLDER.test(String(l.designation)) ? `${propre(l.designation)} : ${texte}` : texte);
    if (Array.isArray(l?.children)) prescriptionsDes(l.children, sortie);
  }
  return sortie;
}

/** `dpgf` : le document déjà décodé (lots > chapitres > lignes). */
export function sourcesPourPlanning(dpgf: any, lots: LotPlanifiable[]): SourcesPlanning {
  const vide: SourcesPlanning = { lots: [], batiments: [], phases: [], aDpgf: false, aCctp: false };
  if (!dpgf || !Array.isArray(dpgf.lots)) return vide;
  const parNumero = new Map(lots.map(l => [normal(l.lot_number), l]));
  const parId = new Map(lots.map(l => [l.id, l]));
  const sortie: SourceLot[] = [];
  let aCctp = false;

  for (const lotDoc of dpgf.lots) {
    const lot = (lotDoc?.projectLotId && parId.get(lotDoc.projectLotId)) || parNumero.get(normal(lotDoc?.numero));
    if (!lot) continue;
    const chapitres: SourceLot['chapitres'] = [];
    // Du plus utile au plus générique : les prescriptions des ouvrages décrits d'abord, le texte général des
    // chapitres réservés au CCTP (objet du document, conditions contractuelles...) en dernier, où le plafond le coupe.
    const prescriptions: string[] = [];
    const generales: string[] = [];
    const generalesLot: string[] = lotDoc?.cctpDescription ? [propre(lotDoc.cctpDescription)] : [];
    for (const chap of lotDoc?.chapitres ?? []) {
      if (chap?.cctpOnly) {
        if (chap?.cctpDescription) generales.push(propre(chap.cctpDescription));
        generales.push(...prescriptionsDes(chap?.lignes ?? []));
        continue;
      }
      if (chap?.cctpDescription) generalesLot.push(propre(chap.cctpDescription));
      prescriptions.push(...prescriptionsDes(chap?.lignes ?? []));
      const postes = postesDe(chap?.lignes ?? []);
      if (!postes.length) continue;
      const tries = [...postes].sort((x, y) => y.montant - x.montant);
      chapitres.push({
        numero: propre(chap?.numero),
        titre: propre(chap?.titre),
        montantHt: Math.round(postes.reduce((n, o) => n + o.montant, 0)),
        ouvrages: tries.slice(0, MAX_OUVRAGES).map(o => o.libelle),
      });
    }
    const texte = [...new Set([...prescriptions, ...generalesLot, ...generales].filter(Boolean))].join(' ');
    if (texte) aCctp = true;
    if (!chapitres.length && !texte) continue;
    sortie.push({
      lotId: lot.id,
      montantHt: chapitres.reduce((n, c) => n + c.montantHt, 0),
      chapitres: chapitres.slice(0, MAX_CHAPITRES),
      cctp: texte.slice(0, MAX_CCTP_CHARS),
    });
  }

  const libelles = (registre: unknown, actif: unknown) =>
    actif && Array.isArray(registre) ? registre.map((e: any) => propre(e?.libelle || e?.code)).filter(Boolean) : [];
  return {
    lots: sortie,
    batiments: libelles(dpgf.batiments, dpgf.multiBatiments),
    phases: libelles(dpgf.phases, dpgf.multiPhases),
    aDpgf: sortie.some(l => l.chapitres.length > 0),
    aCctp,
  };
}

/** Le bloc de texte donné au modèle pour un lot. */
export function texteSourceLot(source: SourceLot | undefined): string {
  if (!source) return '';
  const lignes = source.chapitres.map(c => `  - ${c.numero ? `${c.numero} ` : ''}${c.titre}${c.montantHt > 0 ? ` (${c.montantHt} € HT)` : ''} : ${c.ouvrages.join(' ; ')}`);
  return [
    source.chapitres.length ? `  DPGF, ${source.chapitres.length} chapitre${source.chapitres.length > 1 ? 's' : ''} :` : '',
    ...lignes,
    source.cctp ? `  CCTP : ${source.cctp}` : '',
  ].filter(Boolean).join('\n');
}
