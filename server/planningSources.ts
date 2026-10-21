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
const MAX_OUVRAGES = 5;
const MAX_CCTP_CHARS = 900;

const normal = (n: unknown) => String(n ?? '').trim().toLowerCase().replace(/^lot\s*/, '').replace(/^0+(?=\d)/, '');
const nombre = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const propre = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Lignes d'ouvrage comptées en base (ni option, ni variante, ni pour mémoire), sous-articles compris. */
function ouvragesDe(lignes: any[], sortie: any[] = []): any[] {
  for (const l of lignes ?? []) {
    if (l?.cctpOnly) continue;
    if (Array.isArray(l?.children) && l.children.length) ouvragesDe(l.children, sortie);
    else if (l?.type === 'ouvrage' || l?.type === undefined) {
      if ((l?.nature ?? 'base') === 'base' && !l?.pourMemoire) sortie.push(l);
    }
  }
  return sortie;
}

function textesCctp(lignes: any[], sortie: string[] = []): string[] {
  for (const l of lignes ?? []) {
    if (l?.cctpDescription) sortie.push(propre(l.cctpDescription));
    if (Array.isArray(l?.children)) textesCctp(l.children, sortie);
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
    const cctp: string[] = lotDoc?.cctpDescription ? [propre(lotDoc.cctpDescription)] : [];
    for (const chap of lotDoc?.chapitres ?? []) {
      if (chap?.cctpDescription) cctp.push(propre(chap.cctpDescription));
      cctp.push(...textesCctp(chap?.lignes ?? []));
      if (chap?.cctpOnly) continue;
      const ouvrages = ouvragesDe(chap?.lignes ?? []);
      if (!ouvrages.length) continue;
      const tries = [...ouvrages].sort((a, b) => nombre(b.prixTotal) - nombre(a.prixTotal));
      chapitres.push({
        numero: propre(chap?.numero),
        titre: propre(chap?.titre),
        montantHt: Math.round(ouvrages.reduce((n, o) => n + nombre(o.prixTotal), 0)),
        ouvrages: tries.slice(0, MAX_OUVRAGES).map(o =>
          `${propre(o.designation)}${nombre(o.quantite) > 0 ? ` (${nombre(o.quantite)} ${propre(o.unite)})` : ''}`.slice(0, 120)),
      });
    }
    const texte = cctp.filter(Boolean).join(' ');
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
  const lignes = source.chapitres.map(c => `  - ${c.numero ? `${c.numero} ` : ''}${c.titre} (${c.montantHt} € HT) : ${c.ouvrages.join(' ; ')}`);
  return [
    source.chapitres.length ? `  DPGF, ${source.chapitres.length} chapitre${source.chapitres.length > 1 ? 's' : ''} :` : '',
    ...lignes,
    source.cctp ? `  CCTP : ${source.cctp}` : '',
  ].filter(Boolean).join('\n');
}
