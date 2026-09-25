// ── Groupement d'un DPGF par bâtiment et/ou par phase ────────────────────────
// Logique pure partagée par la vue écran (DpgfGroupedView) et par l'export
// PDF/Excel (proExport.ts) : les deux doivent montrer EXACTEMENT le même
// classement, jamais deux implémentations qui pourraient diverger.
import type { DPGF, Ligne, Lot, Chapitre, GroupementDpgf } from '../types/dpgf';
import { batimentEffectif, phaseEffective, decoupageDe } from '../types/dpgf';

export interface ArticleAplati {
  ligne: Ligne;
  lot: Lot;
  chapitre: Chapitre;
  batimentId?: string;
  phaseId?: string;
}

/** Aplatit l'arbre en une liste d'articles chiffrables (les parents à enfants
 * ne s'y trouvent pas : ils portent la somme de leurs enfants, pas leur
 * propre montant, et n'ont donc pas leur place dans une addition par groupe). */
export function aplatirDpgf(dpgf: DPGF): ArticleAplati[] {
  const out: ArticleAplati[] = [];
  const descendre = (lignes: Ligne[], lot: Lot, chapitre: Chapitre) => {
    for (const l of lignes) {
      if (l.children?.length) { descendre(l.children, lot, chapitre); continue; }
      out.push({
        ligne: l, lot, chapitre,
        batimentId: batimentEffectif(lot, chapitre, l),
        phaseId: phaseEffective(lot, chapitre, l),
      });
    }
  };
  for (const lot of dpgf.lots) {
    for (const chapitre of lot.chapitres) descendre(chapitre.lignes, lot, chapitre);
  }
  return out;
}

export const SANS_AFFECTATION = '__sans__';

export interface GroupeArticles {
  libelle: string;
  articles: ArticleAplati[];
  total: number;
}

const parOrdre = <T extends { ordre: number }>(items: T[]) => [...items].sort((a, b) => a.ordre - b.ordre);

/**
 * Regroupe les articles d'un DPGF selon le critère choisi. Les groupes
 * « sans affectation » ferment la liste (une exception à régulariser, pas le
 * premier chiffre qu'on veut voir) ; les autres suivent l'ordre déclaré des
 * bâtiments/phases dans le registre du document, pas un tri alphabétique.
 */
export function grouperDpgf(dpgf: DPGF, groupement: Exclude<GroupementDpgf, 'lot'>): [string, GroupeArticles][] {
  const { batiments, phases } = decoupageDe(dpgf);
  const articles = aplatirDpgf(dpgf);

  const libelleBatiment = (id?: string) =>
    (id && batiments.find(b => b.id === id)?.libelle) || (id && batiments.find(b => b.id === id)?.code) || 'Sans bâtiment identifié';
  const libellePhase = (id?: string) =>
    (id && phases.find(p => p.id === id)?.libelle) || (id && phases.find(p => p.id === id)?.code) || 'Sans phase identifiée';

  const clefEtLibelle = (a: ArticleAplati): { clef: string; libelle: string } => {
    if (groupement === 'batiment') {
      return { clef: a.batimentId ?? SANS_AFFECTATION, libelle: libelleBatiment(a.batimentId) };
    }
    if (groupement === 'phase') {
      return { clef: a.phaseId ?? SANS_AFFECTATION, libelle: libellePhase(a.phaseId) };
    }
    return {
      clef: `${a.batimentId ?? SANS_AFFECTATION}::${a.phaseId ?? SANS_AFFECTATION}`,
      libelle: `${libelleBatiment(a.batimentId)} — ${libellePhase(a.phaseId)}`,
    };
  };

  const map = new Map<string, GroupeArticles>();
  for (const a of articles) {
    const { clef, libelle } = clefEtLibelle(a);
    const g = map.get(clef) ?? { libelle, articles: [], total: 0 };
    g.articles.push(a);
    g.total += a.ligne.prixTotal || 0;
    map.set(clef, g);
  }

  // Rang du bâtiment/de la phase dans son registre déclaré, « sans
  // affectation » toujours après tout ce qui est identifié.
  const rangBatiment = (id: string) => {
    if (id === SANS_AFFECTATION) return Infinity;
    const i = parOrdre(batiments).findIndex(b => b.id === id);
    return i < 0 ? Infinity : i;
  };
  const rangPhase = (id: string) => {
    if (id === SANS_AFFECTATION) return Infinity;
    const i = parOrdre(phases).findIndex(p => p.id === id);
    return i < 0 ? Infinity : i;
  };
  const rangDeClef = (clef: string): [number, number] => {
    if (groupement === 'batiment') return [rangBatiment(clef), 0];
    if (groupement === 'phase') return [rangPhase(clef), 0];
    const [bId, pId] = clef.split('::');
    return [rangBatiment(bId), rangPhase(pId)];
  };

  return [...map.entries()].sort(([ca], [cb]) => {
    const [a1, a2] = rangDeClef(ca);
    const [b1, b2] = rangDeClef(cb);
    return a1 !== b1 ? a1 - b1 : a2 - b2;
  });
}
