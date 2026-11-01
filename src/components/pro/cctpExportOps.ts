// ── Export des postes sélectionnés vers la bibliothèque ──────────────────────
// L'export reprend ce que le CCTP contient déjà : l'architecte ne ressaisit
// rien. Un article devient un OUVRAGE (désignation, unité, prix, texte) ; un lot
// ou un chapitre devient une CLAUSE dont le texte est celui du poste suivi, au
// choix, de celui de ses chapitres et articles (chacun sous son intitulé en
// gras). Sans cela, un lot dont le texte propre est vide (le cas courant : le
// contenu est dans ses articles) donnait une clause vide à compléter à la main.
import type { Chapitre, Lot, Ligne } from '../../types/dpgf';
import { ligneAtPath, hierarchyKey } from './hierarchyOps';
import { parseSelection } from './selectionOps';
import { racinesDeSelection } from './cctpBulkOps';

export type TypeExport = 'clause' | 'ouvrage';

export interface ElementExport {
  /** Clé de sélection positionnelle (`lot-0`, `chap-0-1`, `ligne-0-1-2`). */
  cle: string;
  kind: 'lot' | 'chapitre' | 'article';
  numero: string;
  titre: string;
  /** Type proposé : clause pour un lot ou un chapitre, ouvrage pour un article. */
  type: TypeExport;
  unite: string;
  prix_unitaire: number;
  /** Texte repris du CCTP, sous-éléments compris si demandé. */
  description: string;
  /** Sous-éléments dont le texte est repris (lot : chapitres, chapitre/article : articles). */
  nbChapitres: number;
  nbArticles: number;
  /** L'article est déjà lié à la bibliothèque : l'exporter de nouveau en ferait un doublon. */
  dejaLie: boolean;
}

const texte = (v: string | undefined | null) => (v ?? '').trim();
const intitule = (numero: string, titre: string) => [numero, titre].map(s => (s ?? '').trim()).filter(Boolean).join(' ');
/** Un sous-élément sans aucun texte (ni lui, ni ses enfants) n'apporte rien : pas d'intitulé orphelin. */
const bloc = (numero: string, titre: string, contenu: string) =>
  contenu ? `[b]${intitule(numero, titre)}[/b]\n${contenu}` : '';
const assembler = (parties: string[]) => parties.filter(Boolean).join('\n\n');

function contenuLigne(l: Ligne, avecEnfants: boolean): string {
  const enfants = avecEnfants ? (l.children ?? []).map(c => bloc(c.numero, c.designation, contenuLigne(c, true))) : [];
  return assembler([texte(l.cctpDescription), ...enfants]);
}

function contenuChapitre(c: Chapitre, avecSous: boolean): string {
  const lignes = avecSous ? c.lignes.map(l => bloc(l.numero, l.designation, contenuLigne(l, true))) : [];
  return assembler([texte(c.cctpDescription), ...lignes]);
}

function contenuLot(lot: Lot, avecSous: boolean): string {
  const chapitres = avecSous ? lot.chapitres.map(c => bloc(c.numero, c.titre, contenuChapitre(c, true))) : [];
  return assembler([texte((lot as { cctpDescription?: string }).cctpDescription), ...chapitres]);
}

const compterLignes = (lignes: Ligne[]): number => lignes.reduce((n, l) => n + 1 + compterLignes(l.children ?? []), 0);

/**
 * Les éléments à exporter pour une sélection, dans l'ordre du document. Avec les
 * sous-éléments, seuls les éléments de plus haut niveau sont retenus : un chapitre
 * sélectionné avec son lot est déjà dans le texte du lot.
 */
export function elementsAExporter(lots: Lot[], keys: Iterable<string>, opts: { avecSousElements: boolean }): ElementExport[] {
  const cles = [...keys];
  const choisis = opts.avecSousElements ? racinesDeSelection(cles) : parseSelection(cles);
  const out: ElementExport[] = [];
  for (const s of choisis) {
    const lot = lots[s.lotIdx];
    if (!lot) continue;
    const cle = hierarchyKey(s);
    if (s.kind === 'lot') {
      out.push({
        cle, kind: 'lot', numero: lot.numero, titre: lot.titre, type: 'clause', unite: '', prix_unitaire: 0,
        description: contenuLot(lot, opts.avecSousElements),
        nbChapitres: opts.avecSousElements ? lot.chapitres.length : 0,
        nbArticles: opts.avecSousElements ? lot.chapitres.reduce((n, c) => n + compterLignes(c.lignes), 0) : 0,
        dejaLie: false,
      });
      continue;
    }
    const chap = lot.chapitres[s.chapIdx];
    if (!chap) continue;
    if (s.kind === 'chapitre') {
      out.push({
        cle, kind: 'chapitre', numero: chap.numero, titre: chap.titre, type: 'clause', unite: '', prix_unitaire: 0,
        description: contenuChapitre(chap, opts.avecSousElements), nbChapitres: 0,
        nbArticles: opts.avecSousElements ? compterLignes(chap.lignes) : 0, dejaLie: false,
      });
      continue;
    }
    const ligne = ligneAtPath(chap.lignes, s.lignePath);
    if (!ligne) continue;
    out.push({
      cle, kind: 'article', numero: ligne.numero, titre: ligne.designation, type: 'ouvrage',
      unite: ligne.unite ?? '', prix_unitaire: Number(ligne.prixUnitaire) || 0,
      description: contenuLigne(ligne, opts.avecSousElements), nbChapitres: 0,
      nbArticles: opts.avecSousElements ? compterLignes(ligne.children ?? []) : 0,
      dejaLie: !!ligne.articleTypeId,
    });
  }
  return out;
}

/** Une clause n'a de sens qu'avec un texte ; un ouvrage garde sa désignation, son unité et son prix sans texte. */
export const estVide = (e: Pick<ElementExport, 'description'>, type: TypeExport): boolean =>
  type === 'clause' && !e.description.trim();

/** Coché d'office : ce qui a du contenu et n'est pas déjà dans la bibliothèque. */
export const inclusParDefaut = (e: ElementExport, type: TypeExport = e.type): boolean => !estVide(e, type) && !e.dejaLie;
