import type { DPGF, Ligne } from '../types/dpgf';
import type { ProIssue } from './proValidation';
import { trouvaillePourId } from './proRecherche';

export type ChampCorrection = 'unite' | 'cctpDescription' | 'designation';

export interface CorrectionIA {
  articleId: string;
  champ: ChampCorrection;
  valeur: string;
  explication: string;
}

export interface ArticleASignaler {
  articleId: string;
  numero: string;
  designation: string;
  unite: string;
  cctpDescription: string;
  lot: string;
  chapitre: string;
  champs: ChampCorrection[];
}

export const MAX_ARTICLES_PAR_APPEL = 15;

export const LIBELLE_CHAMP: Record<ChampCorrection, string> = {
  unite: 'Unité',
  designation: 'Désignation',
  cctpDescription: 'Description technique',
};

function findLigne(lignes: Ligne[], id: string): Ligne | undefined {
  for (const l of lignes) {
    if (l.id === id) return l;
    const sous = l.children?.length ? findLigne(l.children, id) : undefined;
    if (sous) return sous;
  }
  return undefined;
}

/** Les articles signalés dont l'anomalie est corrigeable par du texte, groupés par article. */
export function articlesASignaler(doc: DPGF, issues: ProIssue[]): ArticleASignaler[] {
  const parArticle = new Map<string, Set<ChampCorrection>>();
  for (const i of issues) {
    if (!i.articleId || !i.fixable) continue;
    parArticle.set(i.articleId, (parArticle.get(i.articleId) ?? new Set<ChampCorrection>()).add(i.fixable));
  }
  const out: ArticleASignaler[] = [];
  for (const [articleId, champs] of parArticle) {
    const cible = trouvaillePourId(doc, articleId);
    if (!cible) continue;
    const lot = doc.lots[cible.lotIdx];
    const chap = lot?.chapitres[cible.chapIdx ?? -1];
    const ligne = findLigne(chap?.lignes ?? [], articleId);
    if (!ligne) continue;
    out.push({
      articleId, numero: ligne.numero ?? '', designation: ligne.designation ?? '', unite: ligne.unite ?? '',
      cctpDescription: ligne.cctpDescription ?? '', lot: `${lot.numero} ${lot.titre}`.trim(), chapitre: chap?.titre ?? '',
      champs: [...champs],
    });
  }
  return out;
}

/** Valeur actuelle d'un champ, pour montrer « avant puis après ». */
export function valeurActuelle(doc: DPGF, articleId: string, champ: ChampCorrection): string {
  const cible = trouvaillePourId(doc, articleId);
  const chap = cible && doc.lots[cible.lotIdx]?.chapitres[cible.chapIdx ?? -1];
  return (chap && findLigne(chap.lignes, articleId)?.[champ]) || '';
}

/** Applique des corrections de texte sur un arbre neuf. Ne touche ni quantité ni prix. */
export function appliquerCorrections(doc: DPGF, corrections: CorrectionIA[]): DPGF {
  if (!corrections.length) return doc;
  const parArticle = new Map<string, Partial<Record<ChampCorrection, string>>>();
  for (const c of corrections) parArticle.set(c.articleId, { ...parArticle.get(c.articleId), [c.champ]: c.valeur });
  const maj = (lignes: Ligne[]): Ligne[] => lignes.map(l => {
    const patch = parArticle.get(l.id);
    const children = l.children?.length ? maj(l.children) : l.children;
    return patch || children !== l.children ? { ...l, ...patch, children } : l;
  });
  return { ...doc, lots: doc.lots.map(lot => ({ ...lot, chapitres: lot.chapitres.map(c => ({ ...c, lignes: maj(c.lignes) })) })) };
}
