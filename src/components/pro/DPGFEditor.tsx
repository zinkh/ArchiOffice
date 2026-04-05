import React from 'react';
import { useDPGF } from '../../hooks/useDPGF';
import { DPGFTreeGrid } from './DPGFTreeGrid';

interface DPGFEditorProps {
  projectId: string;
}

export const DPGFEditor: React.FC<DPGFEditorProps> = ({ projectId }) => {
  const { dpgf, loading, totalHT, saveDPGF } = useDPGF(projectId);

  if (loading) return <div>Chargement du DPGF...</div>;

  const handleCreateDPGF = () => {
    saveDPGF({
      id: 'new',
      projectId,
      titre: 'Nouveau DPGF',
      version: '1.0',
      dateCreation: new Date().toISOString(),
      statut: 'draft',
      lots: [],
      totalHT: 0,
      TVA: 20,
      totalTTC: 0
    });
  };

  return (
    <div className="space-y-8 pt-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Éditeur DPGF</h3>
        <div className="text-lg font-bold text-zinc-900 dark:text-white">Total HT: {totalHT.toFixed(2)} €</div>
      </div>
      {dpgf ? (
        <div className="p-4 bg-white rounded-lg shadow">
          <DPGFTreeGrid lots={dpgf.lots} />
        </div>
      ) : (
        <button 
          onClick={handleCreateDPGF}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          + Nouveau DPGF
        </button>
      )}
    </div>
  );
};
