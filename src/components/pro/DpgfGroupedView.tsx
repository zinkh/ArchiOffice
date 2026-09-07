// ── Vue groupée du DPGF, par bâtiment et/ou par phase ────────────────────────
// L'arbre éditable du DPGF reste organisé par lot — c'est la seule vue où l'on
// modifie quoi que ce soit, comme le comparatif ACT reste éditable pendant que
// le BPU ne fait que l'alimenter. Cette vue-ci est une LECTURE : elle
// réordonne les mêmes articles sous un autre angle, sans dupliquer l'arbre
// éditable en un second exemplaire qu'il faudrait garder synchronisé.
import React, { useMemo } from 'react';
import type { DPGF, Ligne, Lot, Chapitre, GroupementDpgf } from '../../types/dpgf';
import { batimentEffectif, phaseEffective, decoupageDe } from '../../types/dpgf';
import { formatCurrency } from '../../lib/utils';

interface ArticleAplati {
  ligne: Ligne;
  lot: Lot;
  chapitre: Chapitre;
  batimentId?: string;
  phaseId?: string;
}

function aplatir(dpgf: DPGF): ArticleAplati[] {
  const out: ArticleAplati[] = [];
  const descendre = (lignes: Ligne[], lot: Lot, chapitre: Chapitre) => {
    for (const l of lignes) {
      // Un article parent porte la somme de ses enfants : il ne se chiffre
      // pas et n'a donc pas sa place dans une addition par groupe.
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

const SANS_AFFECTATION = '__sans__';

export const DpgfGroupedView: React.FC<{ dpgf: DPGF; groupement: GroupementDpgf }> = ({ dpgf, groupement }) => {
  const { batiments, phases } = decoupageDe(dpgf);
  const articles = useMemo(() => aplatir(dpgf), [dpgf]);

  const libelleBatiment = (id?: string) =>
    (id && batiments.find(b => b.id === id)?.libelle) || (id && batiments.find(b => b.id === id)?.code) || 'Sans bâtiment identifié';
  const libellePhase = (id?: string) =>
    (id && phases.find(p => p.id === id)?.libelle) || (id && phases.find(p => p.id === id)?.code) || 'Sans phase identifiée';

  // Clé de groupe et son libellé, selon le critère choisi.
  const clefEtLibelle = (a: ArticleAplati): { clef: string; libelle: string } => {
    if (groupement === 'batiment') {
      return { clef: a.batimentId ?? SANS_AFFECTATION, libelle: libelleBatiment(a.batimentId) };
    }
    if (groupement === 'phase') {
      return { clef: a.phaseId ?? SANS_AFFECTATION, libelle: libellePhase(a.phaseId) };
    }
    // 'batiment-phase'
    return {
      clef: `${a.batimentId ?? SANS_AFFECTATION}::${a.phaseId ?? SANS_AFFECTATION}`,
      libelle: `${libelleBatiment(a.batimentId)} — ${libellePhase(a.phaseId)}`,
    };
  };

  const groupes = useMemo(() => {
    const map = new Map<string, { libelle: string; articles: ArticleAplati[]; total: number }>();
    for (const a of articles) {
      const { clef, libelle } = clefEtLibelle(a);
      const g = map.get(clef) ?? { libelle, articles: [], total: 0 };
      g.articles.push(a);
      g.total += a.ligne.prixTotal || 0;
      map.set(clef, g);
    }
    // Les groupes « sans affectation » ferment la liste : ce sont des
    // exceptions à régulariser, pas le premier chiffre qu'on veut voir.
    return [...map.entries()].sort(([ca], [cb]) => {
      const aSans = ca.includes(SANS_AFFECTATION), bSans = cb.includes(SANS_AFFECTATION);
      if (aSans !== bSans) return aSans ? 1 : -1;
      return ca.localeCompare(cb);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, groupement, batiments, phases]);

  if (articles.length === 0) {
    return <div className="p-10 text-center text-sm text-zinc-400">Ce DPGF est vide.</div>;
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 720 }}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#1e5090] text-white text-xs">
            <th className="px-2 py-2 text-left font-semibold w-20">N°</th>
            <th className="px-2 py-2 text-left font-semibold">Désignation</th>
            <th className="px-2 py-2 text-left font-semibold w-32">Lot</th>
            <th className="px-2 py-2 text-left font-semibold w-28">Localisation</th>
            <th className="px-2 py-2 text-center font-semibold w-16">Unité</th>
            <th className="px-2 py-2 text-right font-semibold w-24">Quantité</th>
            <th className="px-2 py-2 text-right font-semibold w-28">Total HT (€)</th>
          </tr>
        </thead>
        <tbody>
          {groupes.map(([clef, g]) => (
            <React.Fragment key={clef}>
              <tr className="bg-[#c8d8ec] dark:bg-blue-900/30 border-b border-[#9ab0cb]">
                <td colSpan={6} className="px-2 py-1.5 font-bold text-sm text-zinc-700 dark:text-zinc-200">
                  {g.libelle}
                </td>
                <td className="px-2 py-1.5 text-right font-bold text-sm font-mono text-[#1e5090]">
                  {formatCurrency(g.total)}
                </td>
              </tr>
              {g.articles.map(a => (
                <tr key={a.ligne.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-0.5 text-xs text-zinc-400">{a.ligne.numero}</td>
                  <td className="px-2 py-0.5">{a.ligne.designation}</td>
                  <td className="px-2 py-0.5 text-xs text-zinc-500 truncate">{a.lot.numero} {a.lot.titre}</td>
                  <td className="px-2 py-0.5 text-xs text-zinc-500">{a.ligne.localisation || ''}</td>
                  <td className="px-2 py-0.5 text-center">{a.ligne.unite}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{a.ligne.quantite}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(a.ligne.prixTotal || 0)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
