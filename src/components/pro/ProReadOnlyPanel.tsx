import React from 'react';
import type { DPGF, Ligne } from '../../types/dpgf';
import { formatCurrency } from '../../lib/utils';

/** Reference document: no editing callbacks, forms, or save action. */
export function ProReadOnlyPanel({ dpgf, estimation = false, cctp = false, onDragStart }: {
  dpgf: DPGF; estimation?: boolean; cctp?: boolean; onDragStart?: (ligne: Ligne) => void;
}) {
  const rows = (lines: Ligne[], depth = 0): React.ReactNode => lines.filter(l => !l.cctpOnly).map(l => <React.Fragment key={l.id}>
    <tr draggable onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify(l)); e.dataTransfer.effectAllowed = 'copy'; onDragStart?.(l); }} className="border-b cursor-grab">
      <td className="p-2" style={{ paddingLeft: 8 + depth * 14 }}>{l.numero} — {l.designation}</td>
      {cctp ? <td className="p-2">{l.cctpDescription ?? ''}</td> : <><td className="p-2">{l.unite}</td><td className="p-2 text-right">{l.quantite}</td>
      <td className="p-2 text-right">{formatCurrency(l.prixUnitaire)}</td>
      <td className="p-2 text-right">{formatCurrency(l.prixTotal)}</td></>}
      {estimation && <td className="p-2 text-right">{formatCurrency(l.prixTotal * (1 + dpgf.TVA / 100))}</td>}
    </tr>
    {l.children?.length ? rows(l.children, depth + 1) : null}
  </React.Fragment>);
  const columns = estimation ? 6 : 5;
  return <div className="flex-1 overflow-auto p-3" aria-label="Document de référence en lecture seule">
    <p className="text-sm text-zinc-500 mb-3">Lecture seule — glissez un article vers le document de gauche pour le copier.</p>
    {dpgf.lots.length === 0 && <p>Aucun lot dans ce document.</p>}
    {dpgf.lots.map(lot => <details key={lot.id} open className="mb-3 border rounded">
      <summary className="p-2 font-semibold cursor-pointer">{lot.numero} — {lot.titre} · {formatCurrency(lot.sousTotal)}</summary>
      <table className="w-full text-xs"><thead><tr><th className="text-left p-2">Désignation</th><th>{cctp ? 'Description technique' : 'Unité'}</th>{!cctp && <><th>Quantité</th><th>P.U. HT</th><th>Total HT</th></>}{estimation && <th>Total TTC</th>}</tr></thead>
        <tbody>{lot.chapitres.filter(c => !c.cctpOnly).map(c => <React.Fragment key={c.id}>
          <tr className="bg-zinc-100 dark:bg-zinc-800"><th colSpan={columns} className="p-2 text-left">{c.numero} — {c.titre}</th></tr>
          {rows(c.lignes)}
        </React.Fragment>)}</tbody>
      </table>
    </details>)}
    <div className="font-semibold">Total HT : {formatCurrency(dpgf.totalHT)} · Total TTC : {formatCurrency(dpgf.totalTTC)}</div>
  </div>;
}
