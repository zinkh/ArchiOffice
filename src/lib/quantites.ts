// Quantités d'un article : calcul de la saisie, métré, formule mémorisée, prix.
//
// Fonctions pures, partagées par le CCTP, le DPGF et l'Estimation. Différence avec `evalFormula`
// (components/pro/treeOps.ts), conservée pour le reste du code : un calcul invalide est SIGNALÉ ici
// (`{ ok: false }`) au lieu de valoir 0, qui est une quantité (ou un prix) comme une autre.
import { parsePrixSaisi } from '../components/pro/treeOps';
import { formatQuantite } from './quantiteFormat';
import type { Batiment, Ligne, QuantiteDetail } from '../types/dpgf';

export type Calcul = { ok: true; valeur: number } | { ok: false };

/** Lignes d'un métré : au-delà, le document devient inutilement lourd. */
export const MAX_LIGNES_METRE = 200;
/** Valeur absolue maximale d'une ligne et du total (le serveur borne de même les propositions). */
export const VALEUR_MAX = 1e9;
const LONGUEUR_MAX_SAISIE = 200;

/** Un reste de calcul flottant (17,7 + 7,35 = 25.049999999999997) n'est pas une valeur saisie. */
const propre = (n: number) => Number(n.toFixed(10));

/**
 * Analyse d'une expression arithmétique : nombres, + - * /, parenthèses, moins unaire. Pas d'`eval` :
 * aucune autre saisie n'a de sens ici. `null` si l'expression est incomplète, mal formée ou divise par 0.
 */
function evaluerExpression(texte: string): number | null {
  let i = 0;
  const courant = () => texte[i];

  const nombre = (): number | null => {
    const debut = i;
    while (i < texte.length && /[0-9.]/.test(texte[i])) i += 1;
    const lu = texte.slice(debut, i);
    return /^(\d+(\.\d+)?|\.\d+)$/.test(lu) ? Number(lu) : null;
  };
  const facteur = (): number | null => {
    if (courant() === '+') { i += 1; return facteur(); }
    if (courant() === '-') { i += 1; const v = facteur(); return v === null ? null : -v; }
    if (courant() === '(') {
      i += 1;
      const v = somme();
      if (v === null || courant() !== ')') return null;
      i += 1;
      return v;
    }
    return nombre();
  };
  const produit = (): number | null => {
    let v = facteur();
    while (v !== null && (courant() === '*' || courant() === '/')) {
      const operateur = texte[i]; i += 1;
      const d = facteur();
      if (d === null || (operateur === '/' && d === 0)) return null;
      v = operateur === '*' ? v * d : v / d;
    }
    return v;
  };
  function somme(): number | null {
    let v = produit();
    while (v !== null && (courant() === '+' || courant() === '-')) {
      const operateur = texte[i]; i += 1;
      const d = produit();
      if (d === null) return null;
      v = operateur === '+' ? v + d : v - d;
    }
    return v;
  }

  const resultat = somme();
  return resultat !== null && i === texte.length && Number.isFinite(resultat) ? resultat : null;
}

/**
 * Lit une saisie : un nombre (« 10,5 »), un calcul commençant par « = » (« =4*5 ») ou rien (0).
 * Virgule française, espaces et espaces insécables ne comptent pas. Tout le reste est invalide.
 */
export function calculerSaisie(raw: string): Calcul {
  const texte = raw.trim().replace(/[\s  ]/g, '').replace(/,/g, '.');
  if (texte === '') return { ok: true, valeur: 0 };
  if (texte.length > LONGUEUR_MAX_SAISIE) return { ok: false };
  if (texte.startsWith('=')) {
    const corps = texte.slice(1);
    if (!/^[0-9+\-*/.()]*$/.test(corps)) return { ok: false };
    const valeur = evaluerExpression(corps);
    return valeur === null ? { ok: false } : { ok: true, valeur: propre(valeur) };
  }
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(texte) ? { ok: true, valeur: propre(Number(texte)) } : { ok: false };
}

// ── Métré ────────────────────────────────────────────────────────────────────

/** Valeur d'une ligne de métré : son calcul saisi s'il existe, sinon sa quantité (ventilation d'avant). */
export function valeurDetail(d: QuantiteDetail): number {
  if (d.expression === undefined) return Number.isFinite(d.quantite) ? d.quantite : 0;
  const c = calculerSaisie(d.expression);
  return c.ok ? c.valeur : 0;
}

export const totalMetre = (lignes: readonly QuantiteDetail[]): number =>
  propre(lignes.reduce((somme, d) => somme + valeurDetail(d), 0));

/** Libellé d'une ligne : le libellé libre, à défaut niveau et local d'une ventilation d'avant. */
export function libelleDetail(d: QuantiteDetail): string {
  return d.libelle?.trim() || [d.niveau, d.local].filter(Boolean).join(' · ');
}

export type ErreurMetre =
  | { type: 'ligne_invalide'; index: number }
  | { type: 'batiment_manquant'; index: number }
  | { type: 'batiment_negatif'; batimentId: string }
  | { type: 'total_negatif' }
  | { type: 'trop_de_lignes' }
  | { type: 'hors_limites' };

/** Options d'un métré. `parBatiment` : l'article ventile sa quantité par bâtiment, chaque ligne a donc le sien. */
export interface OptionsMetre { parBatiment?: boolean }

/** La somme des lignes de chaque bâtiment. Une ligne sans bâtiment n'entre dans aucun total. */
export function totauxParBatiment(lignes: readonly QuantiteDetail[]): Record<string, number> {
  const totaux: Record<string, number> = {};
  for (const d of lignes) {
    if (!d.batimentId) continue;
    totaux[d.batimentId] = propre((totaux[d.batimentId] ?? 0) + valeurDetail(d));
  }
  return totaux;
}

/**
 * Un métré est valable si chaque ligne se calcule et que le total est compris entre 0 et la borne.
 * Pour un article par bâtiment : chaque ligne a un bâtiment et le total de CHAQUE bâtiment reste positif
 * ou nul (une déduction ne peut pas creuser un bâtiment en négatif en s'équilibrant avec un autre).
 */
export function validerMetre(
  lignes: readonly QuantiteDetail[], options: OptionsMetre = {},
): { ok: true; total: number } | { ok: false; erreur: ErreurMetre } {
  if (lignes.length > MAX_LIGNES_METRE) return { ok: false, erreur: { type: 'trop_de_lignes' } };
  let total = 0;
  for (let index = 0; index < lignes.length; index += 1) {
    const d = lignes[index];
    let valeur: number;
    if (d.expression !== undefined) {
      const c = calculerSaisie(d.expression);
      if (!c.ok) return { ok: false, erreur: { type: 'ligne_invalide', index } };
      valeur = c.valeur;
    } else {
      if (!Number.isFinite(d.quantite)) return { ok: false, erreur: { type: 'ligne_invalide', index } };
      valeur = d.quantite;
    }
    if (Math.abs(valeur) > VALEUR_MAX) return { ok: false, erreur: { type: 'hors_limites' } };
    if (options.parBatiment && !d.batimentId) return { ok: false, erreur: { type: 'batiment_manquant', index } };
    total += valeur;
  }
  total = propre(total);
  if (total > VALEUR_MAX) return { ok: false, erreur: { type: 'hors_limites' } };
  if (options.parBatiment) {
    for (const [batimentId, somme] of Object.entries(totauxParBatiment(lignes))) {
      if (somme < 0) return { ok: false, erreur: { type: 'batiment_negatif', batimentId } };
    }
  }
  if (total < 0) return { ok: false, erreur: { type: 'total_negatif' } };
  return { ok: true, total };
}

/**
 * Les bâtiments que le métré d'un article propose : seulement un article réparti par bâtiment
 * (`quantitesBatiments`) d'une opération à plusieurs bâtiments, dans l'ordre du projet. Sinon `undefined` :
 * le métré reste celui d'un article sans bâtiment, comme avant.
 */
export function batimentsDuMetre(
  doc: { multiBatiments?: boolean; batiments?: Batiment[] }, ligne: Ligne,
): Batiment[] | undefined {
  if (!doc.multiBatiments || ligne.quantitesBatiments === undefined || !doc.batiments?.length) return undefined;
  return [...doc.batiments].sort((a, b) => a.ordre - b.ordre);
}

/** Une ligne sans libellé, sans note et sans valeur : elle n'est jamais enregistrée. */
export const estLigneVide = (d: QuantiteDetail): boolean =>
  libelleDetail(d) === '' && !d.note?.trim()
  && (d.expression === undefined ? !d.quantite : d.expression.trim() === '');

/**
 * Applique un métré à un article. La quantité devient la somme des lignes, le prix total suit
 * (0 pour mémoire) et la formule mémorisée de la case quantité s'efface (la quantité vient du métré).
 * Les lignes entièrement vides sont ignorées ; sans aucune ligne, le métré est retiré et la quantité
 * reste ce qu'elle était. `null` si le métré n'est pas valable : rien ne doit être appliqué.
 * Les champs d'une ventilation d'avant (bâtiment, phase, niveau, local, note) ne sont jamais effacés.
 */
export function appliquerMetre(
  ligne: Ligne, lignes: readonly QuantiteDetail[], options: OptionsMetre = {},
): Partial<Ligne> | null {
  const gardees = lignes.filter(d => !estLigneVide(d));
  if (!gardees.length) return { quantiteDetails: undefined, quantiteFormule: undefined };
  const validation = validerMetre(gardees, options);
  if (!validation.ok) return null;
  const details = gardees.map(d => {
    const copie: QuantiteDetail = { ...d, quantite: valeurDetail(d) };
    if (copie.expression !== undefined) copie.expression = copie.expression.trim();
    if (copie.libelle !== undefined) copie.libelle = copie.libelle.trim();
    return copie;
  });
  const patch: Partial<Ligne> = {
    quantiteDetails: details,
    quantite: validation.total,
    prixTotal: ligne.pourMemoire ? 0 : propre(validation.total * ligne.prixUnitaire),
    quantiteFormule: undefined,
  };
  if (options.parBatiment) {
    // La quantité de chaque bâtiment est la somme de ses lignes. Un bâtiment déjà affecté à l'article mais
    // sans ligne reste à 0 (il n'est pas retiré) ; un bâtiment qui apparaît dans une ligne est ajouté.
    const quantites: Record<string, number> = {};
    for (const id of Object.keys(ligne.quantitesBatiments ?? {})) quantites[id] = 0;
    Object.assign(quantites, totauxParBatiment(details));
    patch.quantitesBatiments = quantites;
  }
  return patch;
}

/**
 * La valeur qu'un confrère envoie pour proposer un métré : la liste JSON de ses lignes, libellé et calcul
 * seulement (le serveur la valide et la met en forme canonique). Les lignes entièrement vides sont ignorées.
 */
export function serialiserMetre(lignes: readonly QuantiteDetail[]): string {
  return JSON.stringify(lignes.filter(d => !estLigneVide(d)).map(d => ({
    libelle: libelleDetail(d),
    expression: (d.expression ?? (d.quantite ? String(d.quantite).replace('.', ',') : '')).trim(),
  })));
}

/**
 * Un métré proposé (liste JSON de { libelle, expression }) en lignes lisibles et son total, pour la boîte
 * des propositions du cabinet. Vide pour « aucun métré » ; une valeur illisible est rendue telle quelle.
 */
export function metreEnTexte(json: string, unite = ''): string {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return json; }
  if (!Array.isArray(data) || data.length === 0) return '';
  const lignes = data.filter((d): d is { libelle?: unknown; expression?: unknown } => !!d && typeof d === 'object');
  const lisibles = lignes.map(d => ({ libelle: String(d.libelle ?? ''), expression: String(d.expression ?? '') }));
  const corps = lisibles.map(d => `${d.libelle || '·'} : ${d.expression || '0'}`);
  const total = totalMetre(lisibles.map((d, i) => ({ id: String(i), libelle: d.libelle, expression: d.expression, quantite: 0 })));
  return [...corps, `Total : ${formatQuantite(total)}${unite ? ` ${unite}` : ''}`].join('\n');
}

// ── Case quantité et case prix ───────────────────────────────────────────────

/** La quantité d'un article vient-elle d'ailleurs que de sa propre case (métré, bâtiments, sous-articles) ? */
const quantiteDerivee = (ligne: Ligne): boolean =>
  !!ligne.quantiteDetails?.length || ligne.quantitesBatiments !== undefined || !!ligne.children?.length;

/**
 * Saisie dans la case quantité. Un calcul (« =10+20 ») est mémorisé : il sera réaffiché à la prochaine
 * modification au lieu de disparaître derrière son résultat. `null` : saisie invalide, ou quantité
 * qui ne se saisit pas ici ; l'appelant ne change rien.
 */
export function quantitePatch(ligne: Ligne, raw: string): Partial<Ligne> | null {
  if (quantiteDerivee(ligne)) return null;
  const c = calculerSaisie(raw);
  if (!c.ok) return null;
  const saisie = raw.trim();
  return {
    quantite: c.valeur,
    prixTotal: ligne.pourMemoire ? 0 : propre(c.valeur * ligne.prixUnitaire),
    quantiteFormule: saisie.startsWith('=') ? saisie : undefined,
  };
}

/** La formule mémorisée, tant qu'elle donne encore la quantité de l'article (sinon elle est périmée). */
export function formuleCourante(ligne: Ligne): string | undefined {
  const formule = ligne.quantiteFormule;
  if (!formule || !formule.trim().startsWith('=')) return undefined;
  const c = calculerSaisie(formule);
  return c.ok && c.valeur === ligne.quantite ? formule : undefined;
}

/** Ce que la case quantité montre quand on la modifie : la formule mémorisée, sinon le nombre. */
export const texteSaisieQuantite = (ligne: Ligne): string =>
  formuleCourante(ligne) ?? (ligne.quantite ? String(ligne.quantite).replace('.', ',') : '');

/**
 * Saisie dans la case prix unitaire : « PM » remet l'article pour mémoire, un nombre ou un calcul le
 * chiffre (et le sort du « pour mémoire »). `null` : saisie invalide, ou article à sous-articles (il
 * porte la somme de ses enfants).
 */
export function prixPatch(ligne: Ligne, raw: string): Partial<Ligne> | null {
  if (parsePrixSaisi(raw).pourMemoire) return { pourMemoire: true, prixUnitaire: 0, prixTotal: 0 };
  if (ligne.children?.length) return null;
  const c = calculerSaisie(raw);
  if (!c.ok) return null;
  return { pourMemoire: undefined, prixUnitaire: c.valeur, prixTotal: propre(ligne.quantite * c.valeur) };
}
