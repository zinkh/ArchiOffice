import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IconTrash, IconPlus, IconRefresh, IconGripVertical } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { startPressDrag } from '../../lib/pressDrag';
import { comparerNumerosDeLot, type LotProjet } from '../../lib/lotsOrder';

interface Lot {
  id: string;
  project_id: string;
  lot_number: string;
  lot_title: string;
}

interface LotsManagerProps {
  projectId: string;
  /**
   * Rappelé après chaque création/suppression/réorganisation, pour que le
   * parent resynchronise sa propre copie des lots. La liste à jour (dans
   * l'ordre) est fournie pour répercuter ordre et numéros sur le DPGF/CCTP.
   */
  onChange?: (lots: LotProjet[]) => void;
}

export const LotsManager: React.FC<LotsManagerProps> = ({ projectId, onChange }) => {
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLot, setNewLot] = useState({ number: '', title: '' });

  const fetchLots = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Lot[]>(`/api/projects/${projectId}/lots`);
      const tries = [...rows].sort((a, b) => comparerNumerosDeLot(a.lot_number, b.lot_number));
      setLots(tries);
      return tries;
    } catch (err) {
      console.error('Failed to fetch lots:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const notifier = (rows: Lot[] | null) => { if (rows) onChange?.(rows); };

  // ── Réorganisation par glisser-déposer ──────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const lotsRef = useRef<Lot[]>([]);
  lotsRef.current = lots;

  const persistOrder = async (ordered: Lot[]) => {
    try {
      const rows = await apiFetch<Lot[]>(`/api/projects/${projectId}/lots/order`, {
        method: 'PUT',
        body: JSON.stringify({ ids: ordered.map(l => l.id) }),
      });
      setLots(rows);
      onChange?.(rows);
    } catch (err) {
      console.error('Failed to reorder lots:', err);
      await fetchLots();
    }
  };

  const startReorder = (e: React.PointerEvent<HTMLElement>, id: string) => {
    const avant = lotsRef.current.map(l => l.id).join();
    startPressDrag(e, {
      onLift: () => setDraggingId(id),
      onMove: ({ y }) => {
        const courant = lotsRef.current;
        const de = courant.findIndex(l => l.id === id);
        // Rang visé : nombre de lignes (hors celle tenue) dont le milieu est au-dessus du pointeur.
        let vers = 0;
        for (const l of courant) {
          if (l.id === id) continue;
          const r = rowRefs.current.get(l.id)?.getBoundingClientRect();
          if (r && y > r.top + r.height / 2) vers++;
        }
        if (vers === de) return;
        const next = [...courant];
        const [tenu] = next.splice(de, 1);
        next.splice(vers, 0, tenu);
        // Numéros affichés en direct, l'enregistrement se fait au relâché.
        setLots(next.map((l, i) => ({ ...l, lot_number: String(i + 1).padStart(2, '0') })));
      },
      onEnd: ({ cancelled }) => {
        setDraggingId(null);
        const ordered = lotsRef.current;
        if (cancelled || ordered.map(l => l.id).join() === avant) { if (cancelled) void fetchLots(); return; }
        void persistOrder(ordered);
      },
    });
  };

  useEffect(() => { fetchLots(); }, [fetchLots]);

  const handleAddLot = async () => {
    if (!newLot.number || !newLot.title) return;
    try {
      await apiFetch(`/api/projects/${projectId}/lots`, {
        method: 'POST',
        body: JSON.stringify({ lot_number: newLot.number, lot_title: newLot.title }),
      });
      setNewLot({ number: '', title: '' });
      notifier(await fetchLots());
    } catch (err) {
      console.error('Failed to add lot:', err);
    }
  };

  const handleDeleteLot = async (id: string) => {
    if (!confirm('Supprimer ce lot ?')) return;
    try {
      await apiFetch(`/api/lots/${id}`, { method: 'DELETE' });
      notifier(await fetchLots());
    } catch (err) {
      console.error('Failed to delete lot:', err);
    }
  };

  const generateDefaultLots = async () => {
    const defaults = [
      { number: '01', title: 'Gros Œuvre' },
      { number: '02', title: 'Charpente-Couverture' },
      { number: '03', title: 'Électricité CFO/CFA' },
    ];
    try {
      for (const lot of defaults) {
        await apiFetch(`/api/projects/${projectId}/lots`, {
          method: 'POST',
          body: JSON.stringify({ lot_number: lot.number, lot_title: lot.title }),
        });
      }
      notifier(await fetchLots());
    } catch (err) {
      console.error('Failed to generate default lots:', err);
    }
  };

  return (
    <div className="space-y-8 pt-8 pb-8">
      <div className="flex justify-between items-center pb-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
        <div>
          <h3 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>Lots de travaux</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
            Ces lots servent de base à la consultation des entreprises (onglet ACT).
          </p>
        </div>
        <button
          onClick={() => void generateDefaultLots()}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
        >
          <IconRefresh size={18} />
          Générer les lots par défaut
        </button>
      </div>

      <div className="rounded-xl border overflow-hidden shadow-sm" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
        <div className="overflow-x-auto">
        <table className="min-w-full text-left border-collapse">
          <thead>
            <tr className="border-b" style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}>
              <th className="p-4 w-10" aria-label="Déplacer" />
              <th className="p-4 font-bold text-sm">N°</th>
              <th className="p-4 font-bold text-sm">Intitulé</th>
              <th className="p-4 font-bold text-sm text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr
                key={lot.id}
                ref={el => { if (el) rowRefs.current.set(lot.id, el); else rowRefs.current.delete(lot.id); }}
                className={`border-b hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${draggingId === lot.id ? 'bg-zinc-100 dark:bg-zinc-800 shadow-md relative' : ''}`}
                style={{ borderColor: 'var(--tblr-border)' }}
              >
                <td className="p-2 w-10 text-center">
                  <button
                    type="button"
                    data-no-drag
                    aria-label={`Déplacer le lot ${lot.lot_title}`}
                    title="Glisser pour réorganiser (renumérotation automatique)"
                    onPointerDown={e => startReorder(e, lot.id)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 cursor-grab active:cursor-grabbing touch-none"
                  >
                    <IconGripVertical size={18} />
                  </button>
                </td>
                <td className="p-4 text-sm font-medium">{lot.lot_number}</td>
                <td className="p-4 text-sm">{lot.lot_title}</td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => void handleDeleteLot(lot.id)}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <IconTrash size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {lots.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="p-8 text-center italic" style={{ color: 'var(--tblr-muted)' }}>
                  Aucun lot défini pour ce projet.
                </td>
              </tr>
            )}
            <tr style={{ background: 'var(--tblr-surface-2)' }}>
              <td />
              <td className="p-4">
                <input
                  type="text"
                  placeholder="N°"
                  value={newLot.number}
                  onChange={(e) => setNewLot({ ...newLot, number: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && void handleAddLot()}
                  className="w-full p-2 bg-white dark:bg-zinc-900 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  style={{ borderColor: 'var(--tblr-border)' }}
                />
              </td>
              <td className="p-4">
                <input
                  type="text"
                  placeholder="Intitulé du lot (ex : Gros œuvre)"
                  value={newLot.title}
                  onChange={(e) => setNewLot({ ...newLot, title: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && void handleAddLot()}
                  className="w-full p-2 bg-white dark:bg-zinc-900 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  style={{ borderColor: 'var(--tblr-border)' }}
                />
              </td>
              <td className="p-4 text-right">
                <button
                  onClick={() => void handleAddLot()}
                  disabled={!newLot.number || !newLot.title}
                  className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <IconPlus size={18} />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};
