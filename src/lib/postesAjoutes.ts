// ── Postes ajoutés par une entreprise, et import dans un document vierge ─────
// Deux usages d'une même idée : une ligne d'un fichier qui ne correspond à
// aucun article existant peut devenir un POSTE.
//   - dans une offre : le poste reste attaché à l'offre (`postesAjoutes`), le
//     document de référence n'est pas modifié et le comparatif ACT le marque
//     « ajouté par l'entreprise » ;
//   - dans un document vierge (DPGF, CCTP, DQE, BPU) : le poste devient un
//     article du document, rangé sous son lot.
// Logique pure, sans React, pour rester testable.
import type { Lot, Chapitre, Ligne, PosteAjoute } from '../types/dpgf';
import { normalizeNumero, type LigneImportee } from './bpuImport';
import { uid } from '../components/pro/treeOps';

/** « 01.02 » et « 1.2 » désignent le même lot ; seul le premier segment compte. */
function segments(numero: string): string[] {
  return normalizeNumero(numero).split('.').filter(Boolean);
}

/**
 * Lot d'un poste : le lot dont le numéro est le premier segment du numéro de la
 * ligne (« 02.05 » -> lot « 02 »), à défaut le lot de la ligne précédente du
 * fichier, à défaut le premier lot. `undefined` seulement si le document n'a
 * aucun lot.
 */
export function lotPourLigne(numero: string, lots: Lot[], lotPrecedent?: string): string | undefined {
  const [premier] = segments(numero);
  if (premier) {
    const lot = lots.find(l => normalizeNumero(l.numero) === premier);
    if (lot) return lot.id;
  }
  return lotPrecedent ?? lots[0]?.id;
}

/** Poste d'offre tiré d'une ligne du fichier non rattachée. */
export function creerPosteAjoute(source: LigneImportee, lots: Lot[], lotPrecedent?: string): PosteAjoute {
  return {
    id: uid(),
    numero: source.numero || source.ref,
    designation: source.designation,
    unite: source.unite,
    quantite: source.quantite,
    prixUnitaire: source.prixUnitaire,
    lotId: lotPourLigne(source.numero || source.ref, lots, lotPrecedent),
  };
}

/**
 * Postes d'une offre, dans l'ordre du fichier. Le lot d'une ligne sans lot
 * reconnaissable est celui de la ligne qui la précède, ce qui range une suite de
 * postes sans numéro avec leurs voisins plutôt que dans le premier lot.
 */
export function postesDepuisLignes(sources: LigneImportee[], lots: Lot[]): PosteAjoute[] {
  const out: PosteAjoute[] = [];
  let precedent: string | undefined;
  for (const s of sources) {
    const p = creerPosteAjoute(s, lots, precedent);
    precedent = p.lotId;
    out.push(p);
  }
  return out;
}

/** Montant d'un poste ajouté : sans quantité annoncée, un poste vaut 1 (« ens », « forf »). */
export function montantPoste(p: PosteAjoute): number {
  return p.prixUnitaire != null ? p.prixUnitaire * (p.quantite ?? 1) : 0;
}

export function totalPostesAjoutes(postes: PosteAjoute[] | undefined): number {
  return (postes ?? []).reduce((s, p) => s + montantPoste(p), 0);
}

// ── Rattachement d'un poste ajouté à un article du DPGF ──────────────────────

/** Article du document auquel un poste est rattaché, seulement si cet article existe encore dans le lot. */
export function articleRattache(p: Pick<PosteAjoute, 'articleId'>, idsArticles: ReadonlySet<string>): string | undefined {
  return p.articleId && idsArticles.has(p.articleId) ? p.articleId : undefined;
}

/**
 * Rattache (ou détache, `articleId` null) un poste. Rend une NOUVELLE liste, les autres postes sont inchangés ;
 * la même liste si le poste n'existe pas ou n'a pas à changer.
 */
export function rattacherPoste(postes: PosteAjoute[], posteId: string, articleId: string | null): PosteAjoute[] {
  const cible = postes.find(p => p.id === posteId);
  if (!cible || (cible.articleId ?? null) === articleId) return postes;
  return postes.map(p => {
    if (p.id !== posteId) return p;
    const { articleId: _ancien, ...reste } = p;
    return articleId ? { ...reste, articleId } : reste;
  });
}

/**
 * Article que le texte d'un poste désigne : « (poste 3.2 du DPGF, chiffré en forfait) » renvoie l'article de code
 * « 3.2 ». Une SUGGESTION : rien n'est rattaché sans geste de l'architecte. Sans référence, ou si plusieurs articles
 * du lot portent ce code (les numéros ne sont plus uniques dans un document), aucune suggestion.
 */
export function suggererRattachement(
  designation: string, articles: Array<{ id: string; numero: string }>,
): string | undefined {
  const m = /\bpostes?\s+(?:n[°o]\s*)?(\d+(?:[.\-_]\d+)*[a-z]?)/i.exec(designation);
  if (!m) return undefined;
  const cle = normalizeNumero(m[1]);
  const trouves = articles.filter(a => normalizeNumero(a.numero) === cle);
  return trouves.length === 1 ? trouves[0].id : undefined;
}

// ── Import dans un document vierge ───────────────────────────────────────────

const titreLot = (numero: string) => `Lot ${numero}`;

/**
 * Range des lignes de fichier dans l'arbre lots > chapitres > articles.
 *
 * Le premier segment du numéro désigne le lot, le deuxième (s'il y a trois
 * segments ou plus) le chapitre ; deux segments seulement (« 01.03 ») donnent un
 * article directement sous le chapitre « Articles importés » du lot. Un lot ou un
 * chapitre déjà présent dans le document est complété, jamais dupliqué ; aucun
 * article existant n'est modifié.
 */
export function ajouterLignesAuDocument<T extends Lot>(lots: T[], sources: LigneImportee[]): { lots: T[]; ajoutes: number } {
  const resultat: T[] = lots.map(l => ({ ...l, chapitres: l.chapitres.map(c => ({ ...c, lignes: [...c.lignes] })) }));
  let ajoutes = 0;
  let precedent: string | undefined;

  for (const s of sources) {
    const numero = (s.numero || s.ref || '').trim();
    const segs = segments(numero);
    const cleLot = segs[0] ?? (precedent ?? '0');
    precedent = cleLot;

    let lot = resultat.find(l => normalizeNumero(l.numero) === cleLot);
    if (!lot) {
      const brut = numero.split(/[.\-_]/)[0] || cleLot;
      lot = { id: uid(), numero: brut, titre: titreLot(brut), sousTotal: 0, chapitres: [] } as unknown as T;
      resultat.push(lot);
    }

    const cleChapitre = segs.length >= 3 ? `${cleLot}.${segs[1]}` : `${cleLot}.0`;
    let chap: Chapitre | undefined = lot.chapitres.find(c => normalizeNumero(c.numero) === cleChapitre);
    if (!chap) {
      const libelle = segs.length >= 3 ? numero.split(/[.\-_]/).slice(0, 2).join('.') : `${lot.numero}.0`;
      chap = { id: uid(), numero: libelle, titre: segs.length >= 3 ? `Chapitre ${libelle}` : 'Articles importés', lignes: [] };
      lot.chapitres.push(chap);
    }

    const quantite = s.quantite ?? 0;
    const prixUnitaire = s.prixUnitaire ?? 0;
    const ligne: Ligne = {
      id: uid(), numero, designation: s.designation, unite: s.unite,
      quantite, prixUnitaire, prixTotal: quantite * prixUnitaire, type: 'ouvrage',
    };
    chap.lignes.push(ligne);
    ajoutes++;
  }

  // Les sous-totaux de lot se recalculent à l'ouverture de l'éditeur ; on les
  // tient pourtant à jour pour qu'une lecture directe du document soit juste.
  for (const lot of resultat) {
    const somme = (ls: Ligne[]): number => ls.reduce((t, l) => t + (l.children?.length ? somme(l.children) : l.prixTotal), 0);
    lot.sousTotal = lot.chapitres.reduce((t, c) => t + somme(c.lignes), 0);
  }
  return { lots: resultat, ajoutes };
}
