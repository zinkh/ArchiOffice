import React, { useState } from 'react';
import { CCTPEditor } from './CCTPEditor';
import { DPGFEditor } from './DPGFEditor';
import { LotsManager } from './LotsManager';

interface ProTabProps {
  projectId: string;
}

export const ProTab: React.FC<ProTabProps> = ({ projectId }) => {
  const [activeSubTab, setActiveSubTab] = useState<'LOTS' | 'CCTP' | 'DPGF'>('LOTS');

  return (
    <div className="space-y-8 pt-4">
      <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setActiveSubTab('LOTS')}
          className={`pb-2 px-4 font-bold ${activeSubTab === 'LOTS' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-zinc-500'}`}
        >
          LOTS
        </button>
        <button
          onClick={() => setActiveSubTab('CCTP')}
          className={`pb-2 px-4 font-bold ${activeSubTab === 'CCTP' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-zinc-500'}`}
        >
          CCTP
        </button>
        <button
          onClick={() => setActiveSubTab('DPGF')}
          className={`pb-2 px-4 font-bold ${activeSubTab === 'DPGF' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-zinc-500'}`}
        >
          DPGF
        </button>
      </div>

      <div className="pt-6">
        {activeSubTab === 'LOTS' && <LotsManager projectId={projectId} />}
        {activeSubTab === 'CCTP' && <CCTPEditor projectId={projectId} />}
        {activeSubTab === 'DPGF' && <DPGFEditor projectId={projectId} />}
      </div>
    </div>
  );
};
