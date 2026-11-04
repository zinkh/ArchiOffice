// Vue d'un confrère sur le CCTP et le DPGF, limitée aux lots qui lui sont accordés.
//
// Le CCTP et le DPGF sont UN seul document (dpgfs.data : lots > chapitres > lignes,
// voir src/types/dpgf.ts) : chaque ligne porte le texte du CCTP (`cctpDescription`)
// ET le prix du DPGF. Deux vues en sortent. Un lot accordé l'est pour les DEUX (un seul droit par
// lot), mais elles ne montrent pas la même chose :
//  - « cctp » : désignations et textes, plus quantité, prix, montant et métré des articles (pour les
//    consulter et les proposer depuis le CCTP) ; jamais les totaux du document ni les prix d'un autre lot ;
//  - « dpgf » : quantités et prix, sans les textes ni les lignes réservées au CCTP.
//
// Comme pour le reste du partage, la réponse est CONSTRUITE champ par champ à partir
// de listes blanches, jamais copiée : un champ ajouté demain au document (marqueur de
// rédaction interne, référence de stockage d'une image, provenance IA, bibliothèque
// d'ouvrages) ne fuit pas vers un tiers par simple oubli. Fonctions pures, sans base.

import { randomUUID } from 'node:crypto';
import { recomputeLot } from '../../src/components/pro/treeOps';
import { appliquerMetre, libelleDetail, MAX_LIGNES_METRE, validerMetre } from '../../src/lib/quantites';
import type { Ligne, QuantiteDetail } from '../../src/types/dpgf';

export type DocumentMode = 'cctp' | 'dpgf';

type Rec = Record<string, any>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

const LOT_FIELDS = ['id', 'numero', 'titre', 'projectLotId'] as const;
const CHAPITRE_FIELDS: Record<DocumentMode, readonly string[]> = {
  cctp: ['id', 'numero', 'titre', 'cctpDescription'],
  dpgf: ['id', 'numero', 'titre'],
};
const LIGNE_FIELDS: Record<DocumentMode, readonly string[]> = {
  cctp: ['id', 'numero', 'designation', 'unite', 'localisation', 'cctpDescription', 'type'],
  dpgf: ['id', 'numero', 'designation', 'unite', 'quantite', 'prixUnitaire', 'prixTotal', 'pourMemoire', 'nature', 'tva', 'localisation', 'type'],
};

function pick(row: Rec, keys: readonly string[]): Rec {
  return Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
}

/** Le document stocké, qu'il soit une chaîne JSON ou un objet ; null s'il est illisible. */
export function parseDocument(raw: unknown): Rec | null {
  try {
    const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return isRec(doc) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Ce que la vue CCTP ajoute à un article d'un lot accordé : la quantité, le repère « pour mémoire », le
 * prix unitaire et le montant. Le CCTP et le DPGF sont un seul document et un seul droit par lot : le
 * confrère y voit déjà ces chiffres dans la vue DPGF, et il les propose depuis le CCTP. Jamais les totaux
 * du document ni les prix des autres lots.
 */
const CCTP_CHIFFRES_FIELDS = ['quantite', 'pourMemoire', 'prixUnitaire', 'prixTotal'] as const;

/** Les champs d'une ligne de métré visibles d'un confrère (jamais la note interne, ni le bâtiment ou la phase). */
const METRE_FIELDS = ['id', 'libelle', 'expression', 'quantite', 'niveau', 'local'] as const;

/** Le métré d'un article, champ par champ ; absent quand l'article n'en a pas. */
function viewMetre(ligne: Rec): Rec[] | undefined {
  if (!Array.isArray(ligne.quantiteDetails) || ligne.quantiteDetails.length === 0) return undefined;
  return ligne.quantiteDetails.filter(isRec).map(d => pick(d, METRE_FIELDS));
}

/**
 * `avecChiffres` n'a d'effet que dans la vue CCTP (la vue DPGF porte toujours les chiffres). Il ne vaut
 * jamais pour ce que le DPGF ne contient pas : un article réservé au CCTP (`cctpOnly`), ni ce qui se
 * trouve dessous, n'expose ni quantité, ni prix, ni métré.
 */
function viewLigne(ligne: unknown, mode: DocumentMode, avecChiffres = false): Rec | null {
  if (!isRec(ligne)) return null;
  // `cctpOnly` : texte du CCTP sans ligne de prix, absent du DPGF.
  if (mode === 'dpgf' && ligne.cctpOnly) return null;
  const chiffres = avecChiffres && !ligne.cctpOnly;
  const out = pick(ligne, LIGNE_FIELDS[mode]);
  if (mode === 'cctp' && chiffres) Object.assign(out, pick(ligne, CCTP_CHIFFRES_FIELDS));
  if (mode === 'dpgf' || chiffres) {
    const metre = viewMetre(ligne);
    if (metre) out.quantiteDetails = metre;
  }
  if (Array.isArray(ligne.children)) {
    out.children = ligne.children.map(c => viewLigne(c, mode, chiffres)).filter((c): c is Rec => !!c);
  }
  return out;
}

function viewChapitre(chapitre: unknown, mode: DocumentMode, avecChiffres = false): Rec | null {
  if (!isRec(chapitre)) return null;
  if (mode === 'dpgf' && chapitre.cctpOnly) return null;
  const chiffres = avecChiffres && !chapitre.cctpOnly;
  return {
    ...pick(chapitre, CHAPITRE_FIELDS[mode]),
    lignes: (Array.isArray(chapitre.lignes) ? chapitre.lignes : []).map(l => viewLigne(l, mode, chiffres)).filter((l): l is Rec => !!l),
  };
}

function viewLot(lot: Rec, mode: DocumentMode, avecChiffres = false): Rec {
  return {
    ...pick(lot, LOT_FIELDS),
    chapitres: (Array.isArray(lot.chapitres) ? lot.chapitres : []).map(c => viewChapitre(c, mode, avecChiffres)).filter((c): c is Rec => !!c),
  };
}

/**
 * La vue du document pour un invité : en-tête sans les totaux (ils additionnent TOUS
 * les lots, donc les prix des autres) et seulement les lots dont `projectLotId` est
 * accordé. Un lot du document sans `projectLotId` ne peut jamais être accordé.
 *
 * `chiffresLotIds` (vue CCTP seulement) : les lots dont les articles portent la quantité, le prix, le
 * montant et le métré dans le CCTP. Sans lui, la vue CCTP n'a aucun chiffre.
 */
export function guestDocumentView(
  doc: Rec, mode: DocumentMode, lotIds: ReadonlySet<string>, chiffresLotIds: ReadonlySet<string> = new Set(),
): Rec {
  const lots = (Array.isArray(doc.lots) ? doc.lots : [])
    .filter((l): l is Rec => isRec(l) && typeof l.projectLotId === 'string' && lotIds.has(l.projectLotId))
    .map(l => viewLot(l, mode, chiffresLotIds.has(l.projectLotId)));
  return {
    titre: doc.titre ?? null,
    version: doc.version ?? null,
    statut: doc.statut ?? null,
    dateCreation: doc.dateCreation ?? null,
    lots,
  };
}

export type NodeType = 'lot' | 'chapitre' | 'ligne';

/**
 * Libellé lisible de chaque nœud du document (« 01.1.1 Semelles filantes »), pour la boîte de
 * commentaires du CABINET : un commentaire doit dire sur quoi il porte sans exposer d'identifiant.
 * Réservé au cabinet, qui voit tout le document ; jamais rendu à un invité.
 */
export function nodeLabels(doc: Rec): Map<string, string> {
  const labels = new Map<string, string>();
  const text = (...parts: unknown[]) => parts.filter(p => typeof p === 'string' && p.trim()).join(' ').trim();
  const walk = (lignes: unknown) => {
    for (const l of Array.isArray(lignes) ? lignes : []) {
      if (!isRec(l)) continue;
      if (typeof l.id === 'string') labels.set(l.id, text(l.numero, l.designation));
      walk(l.children);
    }
  };
  for (const lot of Array.isArray(doc.lots) ? doc.lots : []) {
    if (!isRec(lot)) continue;
    if (typeof lot.id === 'string') labels.set(lot.id, text('Lot', lot.numero, lot.titre));
    for (const c of Array.isArray(lot.chapitres) ? lot.chapitres : []) {
      if (!isRec(c)) continue;
      if (typeof c.id === 'string') labels.set(c.id, text(c.numero, c.titre));
      walk(c.lignes);
    }
  }
  return labels;
}

/**
 * Les champs qu'un confrère peut proposer de modifier, par type d'élément. Liste fermée : un
 * champ ajouté demain au document n'est jamais proposable tant qu'il n'est pas ajouté ici.
 *  - texte du CCTP, désignation, titre d'un chapitre ou d'un lot : droit `write` sur le CCTP ;
 *  - quantité, prix unitaire, unité : droit `write` sur le DPGF.
 * Le titre d'un lot vit dans `project_lots` (le document le reçoit de là à chaque lecture).
 */
export const PROPOSABLE_FIELDS = {
  lot: ['titre'],
  chapitre: ['cctpDescription', 'titre'],
  ligne: ['cctpDescription', 'designation', 'quantite', 'prixUnitaire', 'unite', 'metre'],
} as const;
export type ProposableTarget = keyof typeof PROPOSABLE_FIELDS;
export type ProposableField = 'cctpDescription' | 'titre' | 'designation' | 'quantite' | 'prixUnitaire' | 'unite' | 'metre';

/**
 * Quelle vue du document chaque champ demande pour que l'élément soit visible (une ligne réservée au CCTP
 * n'existe pas dans la vue DPGF). Le droit, lui, est le même pour les deux : un lot accordé l'est pour le
 * CCTP et le DPGF.
 */
export const FIELD_KIND: Record<ProposableField, 'cctp' | 'dpgf'> = {
  cctpDescription: 'cctp', titre: 'cctp', designation: 'cctp',
  quantite: 'dpgf', prixUnitaire: 'dpgf', unite: 'dpgf', metre: 'dpgf',
};

/** Champs numériques : leur écriture recalcule le montant de l'article, du lot et du document. */
export const NUMERIC_FIELDS: readonly string[] = ['quantite', 'prixUnitaire'];

/** Champs dont l'écriture recalcule le lot et le document : les numériques, et le métré (il fixe la quantité). */
export const RECOMPUTE_FIELDS: readonly string[] = [...NUMERIC_FIELDS, 'metre'];

/** Champs dont la valeur ne peut pas être vide (un chapitre, un article ou une unité sans libellé n'existe pas). */
export const REQUIRED_TEXT_FIELDS: readonly string[] = ['titre', 'designation', 'unite'];

/** Plafond d'une quantité ou d'un prix : au-delà, c'est une erreur de saisie, pas un devis. */
export const MAX_NUMBER = 1e9;

/**
 * Un nombre saisi par un invité : positif, au plus 4 décimales, virgule française admise, borné.
 * Rend le nombre ou le message d'erreur, jamais un « NaN » enregistré.
 */
export function parseNumberValue(value: unknown, label: string): { number: number } | { error: string } {
  let n: number;
  if (typeof value === 'number') {
    n = value;
    if (Number.isFinite(n) && Math.round(n * 1e4) / 1e4 !== n) return { error: `${label} : 4 décimales au plus.` };
  } else if (typeof value === 'string') {
    const text = value.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,4})?$/.test(text)) return { error: `${label} : un nombre positif est attendu (4 décimales au plus).` };
    n = Number(text);
  } else {
    return { error: `${label} : un nombre est attendu.` };
  }
  if (!Number.isFinite(n) || n < 0 || n > MAX_NUMBER) return { error: `${label} : valeur hors limites.` };
  return { number: n };
}

/**
 * Pourquoi une modification de chiffres ou d'unité ne peut PAS se proposer sur cet article, ou null.
 * Mêmes règles que l'éditeur du DPGF : un parent porte la somme de ses sous-articles et n'a pas de
 * quantité propre ; une quantité répartie par bâtiment ou ventilée par local est la somme de ses
 * parts et se modifie chez le cabinet. Un article « pour mémoire » PEUT recevoir une quantité, une
 * unité et un prix : la quantité et l'unité le laissent « pour mémoire » (montant à 0), un prix
 * supérieur à 0 le chiffre (voir `applyFieldToNode`) et le cabinet en est averti avant d'approuver.
 */
export function blockedEdit(node: Rec, field: string): string | null {
  if (!NUMERIC_FIELDS.includes(field) && field !== 'unite' && field !== 'metre') return null;
  if (node.type && node.type !== 'ouvrage') return 'Seul un article chiffré peut recevoir cette modification.';
  if (Array.isArray(node.children) && node.children.length > 0) {
    return 'Cet article porte des sous-articles : proposez la modification sur chacun d\'eux.';
  }
  // L'unité et le prix ne dépendent pas de la façon dont la quantité est composée.
  if (field === 'unite' || field === 'prixUnitaire') return null;
  if (isRec(node.quantitesBatiments) && Object.keys(node.quantitesBatiments).length > 0) {
    return 'Quantité répartie par bâtiment : elle se modifie dans le DPGF du cabinet.';
  }
  // Un article qui a un métré : sa quantité est la somme de ses lignes, elle se modifie par le métré.
  if (field === 'quantite' && Array.isArray(node.quantiteDetails) && node.quantiteDetails.length > 0) {
    return 'Quantité détaillée par un métré : proposez plutôt un métré modifié.';
  }
  return null;
}

/** Les valeurs sont comparées en texte ; un nombre l'est numériquement (« 12 » et « 12.0 » sont la même quantité). */
export function sameFieldValue(field: string, a: string, b: string): boolean {
  if (NUMERIC_FIELDS.includes(field)) return a !== '' && b !== '' && Number(a) === Number(b);
  return a === b;
}

/** Les lignes du métré d'un article telles que le confrère les voit : libellé et calcul, rien d'autre. */
export function metreLines(node: Rec): { libelle: string; expression: string }[] {
  return (Array.isArray(node.quantiteDetails) ? node.quantiteDetails : []).filter(isRec).map(d => ({
    libelle: libelleDetail(d as unknown as QuantiteDetail),
    expression: typeof d.expression === 'string' ? d.expression.trim() : (Number(d.quantite) ? String(d.quantite).replace('.', ',') : ''),
  }));
}

/**
 * Un métré proposé : une liste JSON de lignes { libelle, expression }. Rend sa forme CANONIQUE (lignes vides
 * retirées, textes nettoyés), la même que `readField`, pour que la comparaison avec le métré actuel soit exacte,
 * ou le message d'erreur. Chaque calcul doit être valide et le total positif ou nul (`validerMetre`, la fonction
 * de l'éditeur).
 */
export function parseMetreValue(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string') return { error: 'Le métré proposé doit être une liste de lignes.' };
  let data: unknown;
  try { data = JSON.parse(value); } catch { return { error: 'Métré illisible.' }; }
  if (!Array.isArray(data)) return { error: 'Le métré proposé doit être une liste de lignes.' };
  if (data.length > MAX_LIGNES_METRE) return { error: `Un métré compte ${MAX_LIGNES_METRE} lignes au plus.` };
  const lignes: { libelle: string; expression: string }[] = [];
  for (const brute of data) {
    if (!isRec(brute) || typeof brute.libelle !== 'string' || typeof brute.expression !== 'string') {
      return { error: 'Chaque ligne du métré a un libellé et un calcul.' };
    }
    const libelle = brute.libelle.trim();
    const expression = brute.expression.trim();
    if (libelle.length > 200 || expression.length > 200) return { error: 'Une ligne du métré est trop longue (200 caractères au plus).' };
    if (!libelle && !expression) continue;
    lignes.push({ libelle, expression });
  }
  const verdict = validerMetre(lignes.map((l, i) => ({ id: String(i), libelle: l.libelle, expression: l.expression, quantite: 0 })));
  if (!verdict.ok) {
    const e = verdict.erreur;
    return { error: e.type === 'ligne_invalide' ? `Ligne ${e.index + 1} du métré : calcul invalide.`
      : e.type === 'total_negatif' ? 'Le total du métré ne peut pas être négatif.'
        : e.type === 'trop_de_lignes' ? `Un métré compte ${MAX_LIGNES_METRE} lignes au plus.`
          : 'Une valeur ou le total du métré dépasse la limite autorisée.' };
  }
  return { value: JSON.stringify(lignes) };
}

/** La valeur d'un champ en texte canonique (une chaîne vide quand il est absent). */
export function readField(node: Rec, field: string): string {
  if (field === 'metre') return JSON.stringify(metreLines(node));
  if (NUMERIC_FIELDS.includes(field)) {
    const value = node[field];
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  }
  return textField(node, field);
}

/**
 * Écrit une valeur dans un nœud. Une quantité ou un prix recalcule le montant de l'article comme
 * l'éditeur (`prixTotal = quantité x P.U.`, 0 pour mémoire), sans arrondi, pour que le document
 * reste identique à ce que l'éditeur aurait produit.
 *
 * « Pour mémoire » veut dire : décrit mais non compté, prix à 0. Un prix unitaire supérieur à 0 le
 * chiffre : l'article QUITTE « pour mémoire » et entre dans le total. Une quantité ou une unité le
 * laissent « pour mémoire » (montant à 0). Les deux états ne se contredisent donc jamais, et le
 * résultat final ne dépend pas de l'ordre dans lequel le cabinet approuve quantité, unité et prix.
 * Rend `leftPourMemoire` quand l'article vient de quitter cet état.
 */
export function applyFieldToNode(node: Rec, field: string, value: string): { leftPourMemoire: boolean } {
  let leftPourMemoire = false;
  if (field === 'metre') {
    // Le métré remplace la liste en bloc. Une ligne reprise telle quelle (même libellé) garde son
    // identifiant et les champs d'une ventilation d'avant (bâtiment, phase, niveau, local, note) :
    // rien n'est perdu. La quantité, le montant et la formule mémorisée suivent `appliquerMetre`, la
    // fonction même de l'éditeur.
    const lignes = JSON.parse(value) as { libelle: string; expression: string }[];
    const avant: QuantiteDetail[] = (Array.isArray(node.quantiteDetails) ? node.quantiteDetails : []).filter(isRec) as unknown as QuantiteDetail[];
    const reprises = new Set<number>();
    const details: QuantiteDetail[] = lignes.map(l => {
      const i = avant.findIndex((e, k) => !reprises.has(k) && libelleDetail(e) === l.libelle);
      if (i >= 0) { reprises.add(i); return { ...avant[i], libelle: l.libelle, expression: l.expression }; }
      return { id: `q_${randomUUID()}`, libelle: l.libelle, expression: l.expression, quantite: 0 };
    });
    const patch = appliquerMetre(node as unknown as Ligne, details);
    if (!patch) throw new Error('Métré invalide : il aurait dû être refusé à la proposition.');
    for (const [cle, valeur] of Object.entries(patch)) {
      if (valeur === undefined) delete node[cle]; else node[cle] = valeur;
    }
    return { leftPourMemoire };
  }
  if (NUMERIC_FIELDS.includes(field)) {
    node[field] = Number(value);
    if (field === 'prixUnitaire' && node.pourMemoire && Number(value) > 0) {
      delete node.pourMemoire;
      leftPourMemoire = true;
    }
    node.prixTotal = node.pourMemoire ? 0 : Number(node.quantite) * Number(node.prixUnitaire);
  } else {
    node[field] = value;
  }
  return { leftPourMemoire };
}

/**
 * Après une modification de chiffres : sous-total du lot et totaux du document, recalculés avec la
 * MÊME fonction que l'éditeur (`recomputeLot`), pour qu'aucun total enregistré ne contredise ses lignes.
 */
export function recomputeAfterNumericChange(doc: Rec, projectLotId: string): void {
  const lots = Array.isArray(doc.lots) ? doc.lots : [];
  const index = lots.findIndex(l => isRec(l) && l.projectLotId === projectLotId);
  if (index < 0) return;
  lots[index] = recomputeLot(lots[index] as any);
  doc.totalHT = lots.reduce((sum: number, l: any) => sum + (Number(l?.sousTotal) || 0), 0);
  doc.totalTTC = doc.totalHT * (1 + (Number(doc.TVA) || 0) / 100);
}

/** Le nœud RÉEL (par référence) d'un lot du document, ou null. Sert à lire et à appliquer une proposition. */
export function findRawNode(doc: Rec, projectLotId: string, targetType: ProposableTarget, targetId: string): Rec | null {
  const lot = (Array.isArray(doc.lots) ? doc.lots : []).find((l): l is Rec => isRec(l) && l.projectLotId === projectLotId);
  if (!lot) return null;
  if (targetType === 'lot') return lot.id === targetId ? lot : null;
  const walk = (lignes: unknown): Rec | null => {
    for (const l of Array.isArray(lignes) ? lignes : []) {
      if (!isRec(l)) continue;
      if (targetType === 'ligne' && l.id === targetId) return l;
      const inChildren = walk(l.children);
      if (inChildren) return inChildren;
    }
    return null;
  };
  for (const c of Array.isArray(lot.chapitres) ? lot.chapitres : []) {
    if (!isRec(c)) continue;
    if (targetType === 'chapitre' && c.id === targetId) return c;
    if (targetType === 'ligne') {
      const found = walk(c.lignes);
      if (found) return found;
    }
  }
  return null;
}

/** La valeur texte d'un champ (une chaîne vide quand il est absent), pour comparer sans ambiguïté. */
export function textField(node: Rec, field: string): string {
  const value = node[field];
  return typeof value === 'string' ? value : '';
}

/** Les nœuds d'un lot tels que l'invité les VOIT : un commentaire ne peut viser que ceux-là. */
export function visibleNodes(viewLotRec: Rec): Record<NodeType, Set<string>> {
  const nodes: Record<NodeType, Set<string>> = { lot: new Set(), chapitre: new Set(), ligne: new Set() };
  if (typeof viewLotRec.id === 'string') nodes.lot.add(viewLotRec.id);
  const walk = (lignes: unknown) => {
    for (const l of Array.isArray(lignes) ? lignes : []) {
      if (isRec(l) && typeof l.id === 'string') nodes.ligne.add(l.id);
      if (isRec(l)) walk(l.children);
    }
  };
  for (const c of Array.isArray(viewLotRec.chapitres) ? viewLotRec.chapitres : []) {
    if (isRec(c) && typeof c.id === 'string') nodes.chapitre.add(c.id);
    if (isRec(c)) walk(c.lignes);
  }
  return nodes;
}
