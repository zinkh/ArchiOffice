// Phase « Négociation » du module ACT : trois vues sur les mêmes données.
import { useState } from 'react';
import type { ProjectLot } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import { cn } from '../../lib/utils';
import { piecesOffreDe, type DonneesNegociation, type Negociation } from '../../lib/actNegociation';
import type { ConsultationNegociationExport } from '../../lib/actNegociationExport';
import NegociationPanel from './NegociationPanel';
import PiecesRecuesGrid from './PiecesRecuesGrid';
import SyntheseEconomique from './SyntheseEconomique';

type Vue = 'fiches' | 'pieces' | 'synthese';
const VUES: { id: Vue; label: string }[] = [
  { id: 'fiches', label: 'Fiches par lot' },
  { id: 'pieces', label: 'Pièces reçues' },
  { id: 'synthese', label: 'Synthèse économique' },
];

interface Props {
  lots: ProjectLot[];
  consultation: ConsultationNegociationExport;
  projectName: string;
  settings: AgencySettings;
  onPatch: (patch: Partial<DonneesNegociation>) => void;
  /** Pose le motif de non-conformité des offres d'une entreprise (pièces manquantes). */
  onMotifNonConformite: (entrepriseId: string, motif: string) => void;
}

export default function NegociationPhase({ lots, consultation, projectName, settings, onPatch, onMotifNonConformite }: Props) {
  const [vue, setVue] = useState<Vue>('fiches');
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Vues de la négociation" className="inline-flex rounded-lg p-1 bg-zinc-100 dark:bg-zinc-800">
        {VUES.map(v => (
          <button
            key={v.id} role="tab" type="button" aria-selected={vue === v.id} onClick={() => setVue(v.id)}
            className={cn('px-4 py-1.5 rounded-md text-xs font-bold transition',
              vue === v.id ? 'bg-white dark:bg-zinc-900 shadow-sm text-[var(--tblr-text)]' : 'text-[var(--tblr-muted)]')}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vue === 'fiches' && (
        <NegociationPanel
          lots={lots} consultation={consultation} projectName={projectName} settings={settings}
          onNegociations={(negociations: Negociation[]) => onPatch({ negociations })}
        />
      )}
      {vue === 'pieces' && (
        <PiecesRecuesGrid
          entreprises={consultation.entreprises}
          piecesAdmin={consultation.pieces_admin ?? []}
          piecesOffre={piecesOffreDe(consultation)}
          recues={consultation.pieces_recues}
          onChange={pieces_recues => onPatch({ pieces_recues })}
          onMotif={onMotifNonConformite}
        />
      )}
      {vue === 'synthese' && (
        <SyntheseEconomique lots={lots} consultation={consultation} projectName={projectName} settings={settings} onPatch={onPatch} />
      )}
    </div>
  );
}
