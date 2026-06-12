import React from 'react';
import { IconShieldCheck, IconInfoCircle } from '@tabler/icons-react';
import type { MafCostResult } from '../types';

interface MafCostBadgeProps {
  result: MafCostResult;
  showDetails?: boolean;
}

function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MafCostBadge({ result, showDetails = false }: MafCostBadgeProps) {
  return (
    <div
      className="rounded-lg border p-3 text-sm"
      style={{ background: '#fff4e6', borderColor: '#ffd8a8', color: '#c05500' }}
    >
      <div className="flex items-center gap-2 font-semibold">
        <IconShieldCheck size={16} />
        Coût assurance MAF estimé : {fmt(result.cotisationEstimee)} €
      </div>
      {showDetails && (
        <div className="mt-2 text-xs space-y-0.5" style={{ color: '#a85d00' }}>
          <div className="flex items-center gap-1">
            <IconInfoCircle size={12} />
            Assiette : M × T × P = {fmt(result.montantM)} × {result.tauxPermil !== undefined ? '' : ''}{fmt(result.assiette)} € HT
          </div>
          <div>Taux de cotisation : {result.tauxPermil} ‰ ({result.label})</div>
        </div>
      )}
    </div>
  );
}
