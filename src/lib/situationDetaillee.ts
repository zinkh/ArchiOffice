// ── Situation détaillée : l'avancement saisi ligne par ligne du DPGF ─────────
// Deux modes de saisie cohabitent sur une situation de travaux :
// - simple : le cumul HT de la situation se saisit directement ;
// - détaillé : un avancement cumulé (%) se saisit sur chaque ligne du DPGF du
//   lot, et le cumul HT en découle (Σ montant de la ligne × avancement).
// Dans les deux cas le certificat de paiement se calcule ensuite de la même
// façon (certificatPaiement.ts) : le mode détaillé ne fait que produire le
// cumul présenté.
//
// Les lignes sont FIGÉES dans la situation (désignation, quantité, prix) : un
// DPGF modifié après coup ne change pas le montant d'une situation déjà
// certifiée. Le prix est celui de l'offre de l'entreprise quand elle a été
// importée dans le DPGF, à défaut celui du DPGF.
import type { DPGF, Ligne, Lot, OffreDocument } from '../types/dpgf';

export type ModeSaisie = 'simple' | 'detaille';

export interface AvancementLigne {
  ligneId: string;
  numero: string;
  designation: string;
  chapitre?: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montantHt: number;
  /** Avancement CUMULÉ depuis le début du marché, en %. */
  avancementPct: number;
}

/** Ligne affichée dans la saisie : la ligne figée, plus l'avancement précédent. */
export interface LigneSaisie extends AvancementLigne {
  avancementPrecedentPct: number;
  /** Ligne présente dans la situation mais retirée du DPGF depuis. */
  retiree?: boolean;
}

export interface LignesDuMarche {
  lots: Lot[];
  lignes: AvancementLigne[];
  /** D'où viennent les prix unitaires. */
  source: 'offre' | 'dpgf';
  offreNom?: string;
  totalHt: number;
}

export const MAX_LIGNES_SITUATION = 2000;

const arrondi = (n: number): number => Math.round(n * 100) / 100;

const normaliser = (s: unknown): string =>
  String(s ?? '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** « 02 », « 2 » et « Lot 2 » désignent le même lot. */
function memeNumeroLot(a: unknown, b: unknown): boolean {
  const na = normaliser(a).replace(/^lot /, '');
  const nb = normaliser(b).replace(/^lot /, '');
  if (!na || !nb) return false;
  if (/^\d+$/.test(na) && /^\d+$/.test(nb)) return Number(na) === Number(nb);
  return na === nb;
}

/** Lots du DPGF correspondant au marché : par numéro, à défaut par intitulé. */
export function lotsDuMarche(dpgf: DPGF | null | undefined, marche: { lot_numero?: string | null; lot_titre?: string | null }): Lot[] {
  const lots = dpgf?.lots ?? [];
  const parNumero = lots.filter((l) => memeNumeroLot(l.numero, marche.lot_numero));
  if (parNumero.length) return parNumero;
  const titre = normaliser(marche.lot_titre);
  return titre ? lots.filter((l) => normaliser(l.titre) === titre) : [];
}

/** Lignes chiffrables : les ouvrages feuilles, hors lignes réservées au CCTP. */
function ouvrages(lignes: Ligne[], acc: Ligne[] = []): Ligne[] {
  for (const l of lignes ?? []) {
    if (l.cctpOnly) continue;
    if (l.children?.length) { ouvrages(l.children, acc); continue; }
    if (l.type === 'ouvrage') acc.push(l);
  }
  return acc;
}

/** Offre retenue de l'entreprise du marché, si elle a été importée dans le DPGF. */
export function offreDuMarche(offres: OffreDocument[] | null | undefined, entrepriseNom: string, lots: Lot[]): OffreDocument | null {
  const nom = normaliser(entrepriseNom);
  if (!nom) return null;
  const ids = new Set(lots.map((l) => l.id));
  const candidates = (offres ?? []).filter((o) =>
    o.statut !== 'ecartee'
    && normaliser(o.entrepriseNom) === nom
    && (!o.lotIds?.length || o.lotIds.some((id) => ids.has(id))));
  return candidates.find((o) => o.statut === 'validee') ?? candidates[0] ?? null;
}

/** Lignes du DPGF qui composent le marché, prix de l'offre quand il existe. */
export function lignesDuMarche(
  dpgf: DPGF | null | undefined,
  offres: OffreDocument[] | null | undefined,
  marche: { entreprise_nom: string; lot_numero?: string | null; lot_titre?: string | null },
): LignesDuMarche {
  const lots = lotsDuMarche(dpgf, marche);
  const offre = offreDuMarche(offres, marche.entreprise_nom, lots);
  const lignes: AvancementLigne[] = [];
  for (const lot of lots) {
    for (const chap of lot.chapitres ?? []) {
      if (chap.cctpOnly) continue;
      for (const l of ouvrages(chap.lignes)) {
        const quantite = Number(l.quantite) || 0;
        const puOffre = offre?.prix?.[l.id];
        const prixUnitaire = typeof puOffre === 'number' ? puOffre : Number(l.prixUnitaire) || 0;
        lignes.push({
          ligneId: l.id,
          numero: l.numero ?? '',
          designation: l.designation ?? '',
          chapitre: [chap.numero, chap.titre].filter(Boolean).join(' '),
          unite: l.unite ?? '',
          quantite,
          prixUnitaire,
          montantHt: arrondi(quantite * prixUnitaire),
          avancementPct: 0,
        });
      }
    }
  }
  return {
    lots, lignes,
    source: offre ? 'offre' : 'dpgf',
    offreNom: offre?.entrepriseNom,
    totalHt: arrondi(lignes.reduce((t, l) => t + l.montantHt, 0)),
  };
}

/** Borne un avancement saisi entre 0 et 100 %. */
export function bornerPct(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

/** Cumul HT d'une situation détaillée : Σ montant de la ligne × avancement cumulé. */
export function montantDepuisLignes(lignes: Pick<AvancementLigne, 'montantHt' | 'avancementPct'>[] | null | undefined): number {
  return arrondi((lignes ?? []).reduce((t, l) => t + (Number(l.montantHt) || 0) * bornerPct(l.avancementPct) / 100, 0));
}

/**
 * Lignes à saisir pour une situation : celles du DPGF (référence), avec
 * l'avancement déjà saisi sur cette situation, sinon celui de la situation
 * précédente (on repart de là où l'on en était). Une ligne figée dans la
 * situation mais disparue du DPGF est conservée, marquée retirée : son
 * avancement compte toujours.
 */
export function lignesASaisir(
  reference: AvancementLigne[],
  courante: AvancementLigne[] | null | undefined,
  precedente: AvancementLigne[] | null | undefined,
): LigneSaisie[] {
  const parId = (liste: AvancementLigne[] | null | undefined) => new Map((liste ?? []).map((l) => [l.ligneId, l]));
  const cur = parId(courante);
  const prev = parId(precedente);
  // La situation déjà enregistrée garde ses prix figés ; une nouvelle prend ceux du DPGF.
  const rows: LigneSaisie[] = reference.map((ref) => {
    const figee = cur.get(ref.ligneId);
    const avancementPrecedentPct = bornerPct(prev.get(ref.ligneId)?.avancementPct ?? 0);
    return {
      ...(figee ?? ref),
      avancementPct: figee ? bornerPct(figee.avancementPct) : avancementPrecedentPct,
      avancementPrecedentPct,
    };
  });
  const connues = new Set(reference.map((r) => r.ligneId));
  for (const l of courante ?? []) {
    if (!connues.has(l.ligneId)) {
      rows.push({ ...l, avancementPct: bornerPct(l.avancementPct), avancementPrecedentPct: bornerPct(prev.get(l.ligneId)?.avancementPct ?? 0), retiree: true });
    }
  }
  return rows;
}

/** Ce qui est enregistré : la ligne figée, sans les champs d'affichage. */
export function figer(rows: LigneSaisie[]): AvancementLigne[] {
  return rows.map(({ avancementPrecedentPct: _p, retiree: _r, ...l }) => ({ ...l, avancementPct: bornerPct(l.avancementPct) }));
}

/**
 * Validation côté serveur d'une liste reçue : types, bornes, taille. Rend la
 * liste nettoyée, ou un message d'erreur.
 */
export function validerAvancementLignes(input: unknown): { lignes?: AvancementLigne[]; error?: string } {
  if (input === null || input === undefined) return { lignes: undefined };
  if (!Array.isArray(input)) return { error: 'avancement_lignes doit être une liste.' };
  if (input.length > MAX_LIGNES_SITUATION) return { error: `Au plus ${MAX_LIGNES_SITUATION} lignes par situation.` };
  const lignes: AvancementLigne[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { error: 'Ligne de situation invalide.' };
    const r = raw as Record<string, unknown>;
    const ligneId = String(r.ligneId ?? '').slice(0, 100);
    if (!ligneId) return { error: 'Ligne de situation sans identifiant.' };
    const nombre = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
    const quantite = nombre(r.quantite);
    const prixUnitaire = nombre(r.prixUnitaire);
    if (Number.isNaN(quantite) || Number.isNaN(prixUnitaire)) return { error: `Quantité ou prix invalide sur la ligne ${ligneId}.` };
    const pct = nombre(r.avancementPct);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return { error: `Avancement hors de 0 à 100 % sur la ligne ${ligneId}.` };
    lignes.push({
      ligneId,
      numero: String(r.numero ?? '').slice(0, 50),
      designation: String(r.designation ?? '').slice(0, 500),
      chapitre: r.chapitre ? String(r.chapitre).slice(0, 200) : undefined,
      unite: String(r.unite ?? '').slice(0, 20),
      quantite,
      prixUnitaire,
      montantHt: arrondi(quantite * prixUnitaire),
      avancementPct: bornerPct(pct),
    });
  }
  return { lignes };
}
