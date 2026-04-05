import React from 'react';
import { useCCTP } from '../../hooks/useCCTP';

interface CCTPEditorProps {
  projectId: string;
}

export const CCTPEditor: React.FC<CCTPEditorProps> = ({ projectId }) => {
  const { cctp, loading, saveCCTP } = useCCTP(projectId);

  if (loading) return <div>Chargement du CCTP...</div>;

  return (
    <div className="space-y-8 pt-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Éditeur CCTP</h3>
      </div>
      {cctp ? (
        <div className="p-4 bg-white rounded-lg shadow">
          <p>Titre: {cctp.titre}</p>
          {/* Implement tree editor here */}
        </div>
      ) : (
        <button 
          onClick={() => saveCCTP({ id: 'new', projectId, titre: 'Nouveau CCTP', version: '1.0', dateCreation: new Date().toISOString(), statut: 'draft', lots: [] })}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          + Nouveau CCTP
        </button>
      )}
    </div>
  );
};
