import React, { useState } from 'react';
import type { DPGF, Ligne } from '../../types/dpgf';
import { buildingQuantities, forBuilding, recomputeBuildings } from '../../lib/dpgfBuildings';
import { exportDPGFtoPDF, exportDPGFtoExcel } from '../../lib/proExport';
import { DecoupagePanel } from './DecoupagePanel';

export function ArticleBuildingPanel({ dpgf, onChange, projectName }: {
  dpgf: DPGF; onChange: (doc: DPGF) => void; projectName?: string;
}) {
  const [selected, setSelected] = useState('');
  const [building, setBuilding] = useState('');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  type Entry = { id: string; label: string; name: string; ligne?: Ligne; inherited?: string };
  const entries: Entry[] = [];
  for (const lot of dpgf.lots) for (const c of lot.chapitres) {
    entries.push({ id: c.id, label: `${c.numero} — ${c.titre}`, name: c.titre });
    const walk = (lines: Ligne[], inherited?: string) => lines.forEach(l => {
      entries.push({ id: l.id, label: `${l.numero} — ${l.designation}`, name: l.designation, ligne: l, inherited });
      walk(l.children ?? [], l.batimentId ?? inherited);
    });
    walk(c.lignes, c.batimentId ?? lot.batimentId);
  }
  const entry = entries.find(e => e.id === selected);
  const patch = (name?: string, quantities?: Record<string, number>) => {
    const walk = (l: Ligne): Ligne => ({ ...l,
      ...(l.id === selected ? { ...(name !== undefined ? { designation: name } : {}), ...(quantities !== undefined ? { quantitesBatiments: quantities, batimentId: undefined } : {}) } : {}),
      children: l.children?.map(walk),
    });
    onChange(recomputeBuildings({ ...dpgf, lots: dpgf.lots.map(lot => ({ ...lot, chapitres: lot.chapitres.map(c => ({ ...c,
      titre: c.id === selected && name !== undefined ? name : c.titre, lignes: c.lignes.map(walk),
    })) })) }));
  };
  const quantities = entry?.ligne ? buildingQuantities(entry.ligne, entry.inherited) : {};
  const exportDoc = async (kind: 'cctp' | 'pdf' | 'xlsx') => {
    setBusy(true); setError('');
    try {
      const b = dpgf.batiments?.find(b => b.id === building);
      if (!b) throw new Error('Choisissez un bâtiment.');
      const doc = forBuilding(dpgf, building, kind === 'cctp');
      if (!doc.lots.length) throw new Error('Aucun article affecté à ce bâtiment.');
      const title = `${projectName ?? dpgf.titre} — ${b.code} ${b.libelle}`;
      if (kind === 'xlsx') await exportDPGFtoExcel(doc, title);
      else if (kind === 'pdf') await exportDPGFtoPDF(doc, title);
      else {
        const { default: JsPDF } = await import('jspdf');
        const pdf = new JsPDF(); let y = 20;
        const text = (value: string, size: number) => {
          pdf.setFontSize(size);
          for (const line of pdf.splitTextToSize(value, 175)) {
            if (y > 277) { pdf.addPage(); y = 20; }
            pdf.text(line, 17, y); y += size * 0.45 + 1;
          }
          y += 3;
        };
        text(`CCTP — ${title}`, 16);
        for (const lot of doc.lots) {
          text(`${lot.numero} — ${lot.titre}`, 14);
          text((lot as typeof lot & { cctpDescription?: string }).cctpDescription ?? '', 10);
          for (const c of lot.chapitres) {
            text(`${c.numero} — ${c.titre}`, 12); text(c.cctpDescription ?? '', 10);
            const walk = (lines: Ligne[]) => lines.forEach(l => {
              text(`${l.numero} — ${l.designation}`, 11); text(l.cctpDescription ?? '', 10);
              if (l.localisation) text(`Localisation : ${l.localisation}`, 10);
              walk(l.children ?? []);
            });
            walk(c.lignes);
          }
        }
        pdf.save(`CCTP_${b.code.replace(/[^a-z0-9_-]/gi, '_')}.pdf`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Échec de l’export.'); }
    finally { setBusy(false); }
  };
  return <details className="no-print border-b p-2 shrink-0 text-sm">
    <summary className="cursor-pointer">Articles et bâtiments — noms, quantités et exports</summary>
    <div className="max-h-64 overflow-auto space-y-2 py-2">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Chapitre ou article à modifier" value={entry?.id ?? ''} onChange={e => setSelected(e.target.value)}>
          <option value="">Choisir un chapitre ou article</option>
          {entries.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        {entry && <input aria-label="Nom du chapitre ou article" className="border rounded px-2 flex-1" value={entry.name} onChange={e => patch(e.target.value)} />}
        <button onClick={() => setSettings(!settings)}>Configurer les bâtiments</button>
      </div>
      {settings && <DecoupagePanel doc={dpgf} onPatch={p => onChange({ ...dpgf, ...p })} onClose={() => setSettings(false)} />}
      {entry?.ligne && !entry.ligne.children?.length && <fieldset className="flex flex-wrap gap-3">
        <legend>Bâtiments de l’article et quantités DPGF ({entry.ligne.unite})</legend>
        {(dpgf.batiments ?? []).map(b => {
          const checked = Object.prototype.hasOwnProperty.call(quantities, b.id);
          return <label key={b.id} className="flex items-center gap-1">
            <input type="checkbox" checked={checked} onChange={e => {
              const next = { ...quantities }; if (e.target.checked) next[b.id] = entry.ligne?.quantitesBatiments === undefined && Object.keys(quantities).length === 0 ? entry.ligne?.quantite ?? 0 : 0; else delete next[b.id]; patch(undefined, next);
            }} />{b.code} {b.libelle}
            {checked && <input aria-label={`Quantité DPGF ${b.code}`} className="w-24 border rounded px-1" type="number" min="0" step="any" value={quantities[b.id]} onChange={e => {
              const q = Number(e.target.value); if (Number.isFinite(q) && q >= 0) patch(undefined, { ...quantities, [b.id]: q });
            }} />}
          </label>;
        })}
        <span>Total : {entry.ligne.quantite} {entry.ligne.unite}</span>
      </fieldset>}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Bâtiment à exporter" value={building} onChange={e => setBuilding(e.target.value)}>
          <option value="">Choisir le bâtiment à exporter</option>
          {(dpgf.batiments ?? []).map(b => <option key={b.id} value={b.id}>{b.code} {b.libelle}</option>)}
        </select>
        <button disabled={busy || !building} onClick={() => void exportDoc('cctp')}>CCTP PDF</button>
        <button disabled={busy || !building} onClick={() => void exportDoc('pdf')}>DPGF PDF</button>
        <button disabled={busy || !building} onClick={() => void exportDoc('xlsx')}>DPGF Excel</button>
      </div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
  </details>;
}
