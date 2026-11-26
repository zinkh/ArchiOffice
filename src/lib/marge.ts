// Taux de marge par article et prix finaux « avec marge ».
//
// Les prix ENREGISTRÉS (prixUnitaire, prixTotal, sousTotal, totalHT) restent toujours HORS marge : c'est
// la base que tous les autres modules lisent (situations, ACT, comparatifs, agents). La marge est une
// couche d'affichage : `appliquerMarge` rend une COPIE du document dont les prix sont majorés, que
// l'estimation, le DPGF et leurs exports affichent à la place de l'original. Fonctions pures.
import { recomputeLot } from '../components/pro/treeOps';
import { calculerSaisie } from './quantites';
import type { DPGF, Ligne } from '../types/dpgf';

/** Borne haute d'un taux de marge, en %. */
export const TAUX_MARGE_MAX = 1000;

const propre = (n: number) => Number(n.toFixed(10));
const centimes = (n: number) => Number(n.toFixed(2));

/** Taux de marge utile d'un article : un nombre fini entre 0 et la borne, sinon 0. */
export function tauxMargeDe(ligne: Pick<Ligne, 'tauxMarge'>): number {
  const t = Number(ligne.tauxMarge);
  return Number.isFinite(t) && t > 0 ? Math.min(t, TAUX_MARGE_MAX) : 0;
}

/** Prix final d'un montant de base : base x (1 + taux / 100), arrondi au centime. */
export const avecMarge = (base: number, taux: number): number => centimes(base * (1 + taux / 100));

/**
 * Saisie dans la case « Marge % » : « 12 », « 12,5 », « 12,5 % » ou un calcul « =10+2,5 ». Vide ou 0 retire la marge.
 * `null` : saisie invalide, négative ou hors borne, ou article à sous-articles (la marge se pose sur les
 * sous-articles) ; l'appelant ne change rien.
 */
export function margePatch(ligne: Pick<Ligne, 'children'>, raw: string): Partial<Ligne> | null {
  if (ligne.children?.length) return null;
  const c = calculerSaisie(raw.replace('%', ''));
  if (!c.ok || c.valeur < 0 || c.valeur > TAUX_MARGE_MAX) return null;
  return { tauxMarge: c.valeur === 0 ? undefined : c.valeur };
}

function majorer(ligne: Ligne): Ligne {
  if (ligne.children?.length) {
    const enfants = ligne.children.map(majorer);
    const avant = ligne.children.reduce((s, c) => s + c.prixTotal, 0);
    const apres = enfants.reduce((s, c) => s + c.prixTotal, 0);
    // Le total propre d'un parent suit ses enfants (c'est la somme des enfants qui est comptée).
    return { ...ligne, children: enfants, prixTotal: avant > 0 ? centimes(ligne.prixTotal * (apres / avant)) : ligne.prixTotal };
  }
  const taux = tauxMargeDe(ligne);
  if (!taux || ligne.pourMemoire) return ligne;
  return {
    ...ligne,
    prixUnitaire: propre(ligne.prixUnitaire * (1 + taux / 100)),
    prixTotal: avecMarge(ligne.prixTotal, taux),
  };
}

const aUneMarge = (lignes: readonly Ligne[]): boolean =>
  lignes.some(l => tauxMargeDe(l) > 0 || (!!l.children?.length && aUneMarge(l.children)));

/**
 * Copie du document avec les prix finaux : chaque article porte `prixUnitaire` et `prixTotal` majorés de son
 * taux, et les sous-totaux de lot et totaux sont recalculés. La structure est identique à l'original (mêmes
 * indices de lot, de chapitre et d'article) : on peut lire l'une à la place de l'autre pour l'affichage. Sans
 * aucune marge, le document est rendu tel quel.
 */
export function appliquerMarge(dpgf: DPGF): DPGF {
  if (!dpgf.lots.some(lot => lot.chapitres.some(chap => aUneMarge(chap.lignes)))) return dpgf;
  const lots = dpgf.lots.map(lot => recomputeLot({
    ...lot,
    chapitres: lot.chapitres.map(chap => ({ ...chap, lignes: chap.lignes.map(majorer) })),
  }));
  const totalHT = lots.reduce((s, l) => s + l.sousTotal, 0);
  return { ...dpgf, lots, totalHT, totalTTC: totalHT * (1 + (Number(dpgf.TVA) || 0) / 100) };
}

/** Le document tel que l'écran ou l'export doit le montrer : avec ses prix finaux si `actif`, sinon l'original. */
export const vueMarge = (dpgf: DPGF, actif: boolean | undefined): DPGF => (actif ? appliquerMarge(dpgf) : dpgf);
