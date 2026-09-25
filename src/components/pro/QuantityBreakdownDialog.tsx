import React, { useMemo, useState } from 'react';
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import type { DPGF, Ligne, QuantiteDetail } from '../../types/dpgf';

interface Props {
  document: DPGF;
  ligne: Ligne;
  onClose: () => void;
  onSave: (details: QuantiteDetail[]) => void;
}

const newDetail = (): QuantiteDetail => ({ id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, quantite: 0 });

export const QuantityBreakdownDialog: React.FC<Props> = ({ document, ligne, onClose, onSave }) => {
  const [rows, setRows] = useState<QuantiteDetail[]>(ligne.quantiteDetails?.length ? structuredClone(ligne.quantiteDetails) : [newDetail()]);
  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.quantite || 0), 0), [rows]);
  const set = (id: string, patch: Partial<QuantiteDetail>) => setRows(v => v.map(r => r.id === id ? { ...r, ...patch } : r));
  const field = 'px-2 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-auto rounded-xl bg-white dark:bg-zinc-900 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b bg-white dark:bg-zinc-900">
          <div><h3 className="font-semibold">Ventilation des quantités</h3><p className="text-xs text-zinc-500">{ligne.numero} — {ligne.designation}</p></div>
          <button onClick={onClose}><IconX size={18} /></button>
        </div>
        <div className="p-4 space-y-2">
          {rows.map(r => (
            <div key={r.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_100px_32px] gap-2">
              {document.multiBatiments ? <select className={field} value={r.batimentId ?? ''} onChange={e => set(r.id, { batimentId: e.target.value || undefined })}><option value="">Bâtiment…</option>{(document.batiments ?? []).map(b => <option key={b.id} value={b.id}>{b.code} — {b.libelle}</option>)}</select> : <input className={field} value="Opération" disabled />}
              {document.multiPhases ? <select className={field} value={r.phaseId ?? ''} onChange={e => set(r.id, { phaseId: e.target.value || undefined })}><option value="">Phase…</option>{(document.phases ?? []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.libelle}</option>)}</select> : <input className={field} value="Phase unique" disabled />}
              <input className={field} placeholder="Niveau" value={r.niveau ?? ''} onChange={e => set(r.id, { niveau: e.target.value })} />
              <input className={field} placeholder="Local / zone" value={r.local ?? ''} onChange={e => set(r.id, { local: e.target.value })} />
              <input className={`${field} text-right`} type="number" step="any" value={r.quantite} onChange={e => set(r.id, { quantite: Number(e.target.value) || 0 })} />
              <button className="text-red-500" onClick={() => setRows(v => v.filter(x => x.id !== r.id))}><IconTrash size={15} /></button>
            </div>
          ))}
          <button className="flex items-center gap-1 text-xs text-blue-600" onClick={() => setRows(v => [...v, newDetail()])}><IconPlus size={14} /> Ajouter une localisation</button>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <span className="font-semibold">Total : {total.toLocaleString('fr-FR')} {ligne.unite}</span>
          <div className="flex gap-2"><button className="px-3 py-1.5 text-sm border rounded" onClick={onClose}>Annuler</button><button className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white" onClick={() => onSave(rows)}>Appliquer à la quantité</button></div>
        </div>
      </div>
    </div>
  );
};
