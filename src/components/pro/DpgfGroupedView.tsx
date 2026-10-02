// ── Vue groupée du DPGF, par bâtiment et/ou par phase ────────────────────────
// L'arbre éditable du DPGF reste organisé par lot — c'est la seule vue où l'on
// modifie quoi que ce soit, comme le comparatif ACT reste éditable pendant que
// le BPU ne fait que l'alimenter. Cette vue-ci est une LECTURE : elle
// réordonne les mêmes articles sous un autre angle, sans dupliquer l'arbre
// éditable en un second exemplaire qu'il faudrait garder synchronisé.
//
// Le calcul des groupes (grouperDpgf) vit dans lib/dpgfGrouping.ts, partagé
// avec l'export PDF/Excel : sans ce partage, l'écran et le document remis au
// client pourraient un jour montrer deux classements différents.
import React, { useMemo } from 'react';
import type { DPGF, GroupementDpgf } from '../../types/dpgf';
import { grouperDpgf } from '../../lib/dpgfGrouping';
import { formatCurrency } from '../../lib/utils';

export const DpgfGroupedView: React.FC<{ dpgf: DPGF; groupement: Exclude<GroupementDpgf, 'lot'> }> = ({ dpgf, groupement }) => {
  const groupes = useMemo(() => grouperDpgf(dpgf, groupement), [dpgf, groupement]);
  const vide = groupes.every(([, g]) => g.articles.length === 0);

  if (groupes.length === 0 || vide) {
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
