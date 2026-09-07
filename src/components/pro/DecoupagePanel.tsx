// ── Bâtiments et phases d'une opération ──────────────────────────────────────
// Un registre au niveau du document (comme les tranches du BPU), pas un
// niveau d'arbre : voir le commentaire de DecoupageDocument dans types/dpgf.ts
// pour le raisonnement. Ce panneau les gère, identique pour les trois
// éditeurs (CCTP, DPGF, BPU/DQE) puisque le registre est le même type partout.
import React from 'react';
import { IconX, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Batiment, DecoupageDocument, PhaseOperation } from '../../types/dpgf';

interface Props {
  doc: DecoupageDocument;
  onPatch: (patch: Partial<DecoupageDocument>) => void;
  onClose: () => void;
}

const newId = () => crypto.randomUUID();
const champ = 'px-2 py-1 text-xs border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none';

export const DecoupagePanel: React.FC<Props> = ({ doc, onPatch, onClose }) => {
  const batiments = doc.batiments ?? [];
  const phases = doc.phases ?? [];

  const ajouterBatiment = () => {
    const b: Batiment = { id: newId(), code: `B${batiments.length + 1}`, libelle: '', ordre: batiments.length };
    onPatch({ multiBatiments: true, batiments: [...batiments, b] });
  };
  const patchBatiment = (id: string, p: Partial<Batiment>) =>
    onPatch({ batiments: batiments.map(b => b.id === id ? { ...b, ...p } : b) });
  const supprimerBatiment = (id: string) =>
    onPatch({ batiments: batiments.filter(b => b.id !== id) });

  const ajouterPhase = () => {
    const p: PhaseOperation = { id: newId(), code: `PH${phases.length + 1}`, libelle: '', ordre: phases.length };
    onPatch({ multiPhases: true, phases: [...phases, p] });
  };
  const patchPhase = (id: string, p: Partial<PhaseOperation>) =>
    onPatch({ phases: phases.map(x => x.id === id ? { ...x, ...p } : x) });
  const supprimerPhase = (id: string) =>
    onPatch({ phases: phases.filter(p => p.id !== id) });

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700 bg-[#f9fafb] dark:bg-zinc-800/30 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Bâtiments et phases</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={14} /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Bâtiments */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-2 cursor-pointer">
            <input
              type="checkbox" checked={!!doc.multiBatiments}
              onChange={e => onPatch({ multiBatiments: e.target.checked })}
            />
            Cette opération compte plusieurs bâtiments
          </label>
          {doc.multiBatiments && (
            <>
              <div className="space-y-1.5">
                {batiments.map(b => (
                  <div key={b.id} className="flex items-center gap-2">
                    <input className={`${champ} w-16`} value={b.code} placeholder="Code"
                           onChange={e => patchBatiment(b.id, { code: e.target.value })} />
                    <input className={`${champ} flex-1`} value={b.libelle} placeholder="Libellé"
                           onChange={e => patchBatiment(b.id, { libelle: e.target.value })} />
                    <button onClick={() => supprimerBatiment(b.id)} className="text-red-400 hover:text-red-600">
                      <IconTrash size={13} />
                    </button>
                  </div>
                ))}
                {batiments.length === 0 && (
                  <p className="text-xs text-zinc-400">Aucun bâtiment défini pour l'instant.</p>
                )}
              </div>
              <button onClick={ajouterBatiment} className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                <IconPlus size={13} /> Ajouter un bâtiment
              </button>
            </>
          )}
        </div>

        {/* Phases */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-2 cursor-pointer">
            <input
              type="checkbox" checked={!!doc.multiPhases}
              onChange={e => onPatch({ multiPhases: e.target.checked })}
            />
            Cette opération se mène en plusieurs phases
          </label>
          {doc.multiPhases && (
            <>
              <div className="space-y-1.5">
                {phases.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <input className={`${champ} w-16`} value={p.code} placeholder="Code"
                           onChange={e => patchPhase(p.id, { code: e.target.value })} />
                    <input className={`${champ} flex-1`} value={p.libelle} placeholder="Libellé"
                           onChange={e => patchPhase(p.id, { libelle: e.target.value })} />
                    <button onClick={() => supprimerPhase(p.id)} className="text-red-400 hover:text-red-600">
                      <IconTrash size={13} />
                    </button>
                  </div>
                ))}
                {phases.length === 0 && (
                  <p className="text-xs text-zinc-400">Aucune phase définie pour l'instant.</p>
                )}
              </div>
              <button onClick={ajouterPhase} className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                <IconPlus size={13} /> Ajouter une phase
              </button>
            </>
          )}
        </div>
      </div>

      {(doc.multiBatiments || doc.multiPhases) && (
        <p className="mt-3 text-[11px] text-zinc-400">
          Un lot, un chapitre ou un article non identifié hérite du bâtiment et de la phase du niveau
          au-dessus ; ne renseignez que les exceptions.
        </p>
      )}
    </div>
  );
};

/** Un couple de <select> compacts pour identifier bâtiment/phase sur une ligne (lot, chapitre, article). */
export const SelecteursDecoupage: React.FC<{
  doc: DecoupageDocument;
  batimentId?: string;
  phaseId?: string;
  onBatimentChange: (id: string | undefined) => void;
  onPhaseChange: (id: string | undefined) => void;
  /** Placeholder de l'option vide, pour dire ce qui est hérité. */
  heriteDe?: string;
}> = ({ doc, batimentId, phaseId, onBatimentChange, onPhaseChange, heriteDe }) => (
  <>
    {doc.multiBatiments && (
      <select
        className="px-1 py-0.5 text-[10px] border border-zinc-200 dark:border-zinc-700 rounded bg-transparent text-zinc-500"
        value={batimentId ?? ''}
        onChange={e => onBatimentChange(e.target.value || undefined)}
        title="Bâtiment"
      >
        <option value="">{heriteDe ? `(${heriteDe})` : '—'}</option>
        {(doc.batiments ?? []).map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
      </select>
    )}
    {doc.multiPhases && (
      <select
        className="px-1 py-0.5 text-[10px] border border-zinc-200 dark:border-zinc-700 rounded bg-transparent text-zinc-500"
        value={phaseId ?? ''}
        onChange={e => onPhaseChange(e.target.value || undefined)}
        title="Phase"
      >
        <option value="">{heriteDe ? `(${heriteDe})` : '—'}</option>
        {(doc.phases ?? []).map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
      </select>
    )}
  </>
);
