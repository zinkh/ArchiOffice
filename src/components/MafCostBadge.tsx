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
      // Une estimation, pas une alerte : surface neutre, en jetons pour suivre
      // le thème sombre.
      style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
    >
      <div className="flex items-center gap-2 font-semibold">
        <IconShieldCheck size={16} aria-hidden style={{ color: 'var(--tblr-primary)' }} />
        Coût assurance MAF estimé : {fmt(result.cotisationEstimee)} €
      </div>
      {showDetails && (
        <div className="mt-2 text-xs space-y-0.5" style={{ color: 'var(--tblr-muted)' }}>
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
