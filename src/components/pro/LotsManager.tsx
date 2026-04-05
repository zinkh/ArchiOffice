import React, { useState, useEffect } from 'react';
import { IconTrash, IconPlus, IconRefresh } from '@tabler/icons-react';

interface Lot {
  id: string;
  project_id: string;
  lot_number: string;
  lot_title: string;
}

interface LotsManagerProps {
  projectId: string;
}

export const LotsManager: React.FC<LotsManagerProps> = ({ projectId }) => {
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLot, setNewLot] = useState({ number: '', title: '' });

  const fetchLots = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/lots`);
      if (res.ok) {
        setLots(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch lots:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLots();
  }, [projectId]);

  const handleAddLot = async () => {
    if (!newLot.number || !newLot.title) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_number: newLot.number, lot_title: newLot.title }),
      });
      if (res.ok) {
        setNewLot({ number: '', title: '' });
        fetchLots();
      }
    } catch (err) {
      console.error('Failed to add lot:', err);
    }
  };

  const handleDeleteLot = async (id: string) => {
    try {
      const res = await fetch(`/api/lots/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchLots();
      }
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

    for (const lot of defaults) {
      await fetch(`/api/projects/${projectId}/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_number: lot.number, lot_title: lot.title }),
      });
    }
    fetchLots();
  };

  return (
    <div className="space-y-8 pt-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Gestion des Lots</h3>
        <button
          onClick={generateDefaultLots}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
        >
          <IconRefresh size={18} />
          Générer les lots par défaut
        </button>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
              <th className="p-4 font-bold text-sm">N°</th>
              <th className="p-4 font-bold text-sm">Intitulé</th>
              <th className="p-4 font-bold text-sm text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                <td className="p-4 text-sm font-medium">{lot.lot_number}</td>
                <td className="p-4 text-sm">{lot.lot_title}</td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => handleDeleteLot(lot.id)}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <IconTrash size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {lots.length === 0 && !loading && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-zinc-500 italic">
                  Aucun lot défini pour ce projet.
                </td>
              </tr>
            )}
            <tr className="bg-zinc-50/50 dark:bg-zinc-800/20">
              <td className="p-4">
                <input
                  type="text"
                  placeholder="N°"
                  value={newLot.number}
                  onChange={(e) => setNewLot({ ...newLot, number: e.target.value })}
                  className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </td>
              <td className="p-4">
                <input
                  type="text"
                  placeholder="Intitulé du lot"
                  value={newLot.title}
                  onChange={(e) => setNewLot({ ...newLot, title: e.target.value })}
                  className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </td>
              <td className="p-4 text-right">
                <button
                  onClick={handleAddLot}
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
  );
};
