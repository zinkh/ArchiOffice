// Vue d'un confrère sur le CCTP et le DPGF, limitée aux lots qui lui sont accordés.
//
// Le CCTP et le DPGF sont UN seul document (dpgfs.data : lots > chapitres > lignes,
// voir src/types/dpgf.ts) : chaque ligne porte le texte du CCTP (`cctpDescription`)
// ET le prix du DPGF. Deux vues en sortent, qui ne montrent pas la même chose :
//  - « cctp » : désignations et textes, JAMAIS de quantité ni de prix ;
//  - « dpgf » : quantités et prix, sans les textes ni les lignes réservées au CCTP.
//
// Comme pour le reste du partage, la réponse est CONSTRUITE champ par champ à partir
// de listes blanches, jamais copiée : un champ ajouté demain au document (marqueur de
// rédaction interne, référence de stockage d'une image, provenance IA, bibliothèque
// d'ouvrages) ne fuit pas vers un tiers par simple oubli. Fonctions pures, sans base.

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

function viewLigne(ligne: unknown, mode: DocumentMode): Rec | null {
  if (!isRec(ligne)) return null;
  // `cctpOnly` : texte du CCTP sans ligne de prix, absent du DPGF.
  if (mode === 'dpgf' && ligne.cctpOnly) return null;
  const out = pick(ligne, LIGNE_FIELDS[mode]);
  if (Array.isArray(ligne.children)) {
    out.children = ligne.children.map(c => viewLigne(c, mode)).filter((c): c is Rec => !!c);
  }
  return out;
}

function viewChapitre(chapitre: unknown, mode: DocumentMode): Rec | null {
  if (!isRec(chapitre)) return null;
  if (mode === 'dpgf' && chapitre.cctpOnly) return null;
  return {
    ...pick(chapitre, CHAPITRE_FIELDS[mode]),
    lignes: (Array.isArray(chapitre.lignes) ? chapitre.lignes : []).map(l => viewLigne(l, mode)).filter((l): l is Rec => !!l),
  };
}

function viewLot(lot: Rec, mode: DocumentMode): Rec {
  return {
    ...pick(lot, LOT_FIELDS),
    chapitres: (Array.isArray(lot.chapitres) ? lot.chapitres : []).map(c => viewChapitre(c, mode)).filter((c): c is Rec => !!c),
  };
}

/**
 * La vue du document pour un invité : en-tête sans les totaux (ils additionnent TOUS
 * les lots, donc les prix des autres) et seulement les lots dont `projectLotId` est
 * accordé. Un lot du document sans `projectLotId` ne peut jamais être accordé.
 */
export function guestDocumentView(doc: Rec, mode: DocumentMode, lotIds: ReadonlySet<string>): Rec {
  const lots = (Array.isArray(doc.lots) ? doc.lots : [])
    .filter((l): l is Rec => isRec(l) && typeof l.projectLotId === 'string' && lotIds.has(l.projectLotId))
    .map(l => viewLot(l, mode));
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
 * Les champs TEXTE qu'un confrère peut proposer de modifier, par type d'élément. Liste fermée :
 * pas de quantité, de prix, d'unité ni de titre de lot (celui-ci appartient à `project_lots`,
 * `withProjectLotTitles` le réapplique à chaque lecture). Un champ ajouté demain au document
 * n'est jamais proposable tant qu'il n'est pas ajouté ici.
 */
export const PROPOSABLE_FIELDS = {
  chapitre: ['cctpDescription', 'titre'],
  ligne: ['cctpDescription', 'designation'],
} as const;
export type ProposableTarget = keyof typeof PROPOSABLE_FIELDS;

/** Champs dont la valeur ne peut pas être vide (un chapitre ou un article sans intitulé n'existe pas). */
export const REQUIRED_TEXT_FIELDS: readonly string[] = ['titre', 'designation'];

/** Le nœud RÉEL (par référence) d'un lot du document, ou null. Sert à lire et à appliquer une proposition. */
export function findRawNode(doc: Rec, projectLotId: string, targetType: ProposableTarget, targetId: string): Rec | null {
  const lot = (Array.isArray(doc.lots) ? doc.lots : []).find((l): l is Rec => isRec(l) && l.projectLotId === projectLotId);
  if (!lot) return null;
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
