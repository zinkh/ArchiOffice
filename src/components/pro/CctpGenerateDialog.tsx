import React, { useEffect, useState } from 'react';
import { IconX, IconAlertTriangle, IconLoader2, IconSparkles } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import type { CctpGenerationEngine, GeneratedLot } from '../../lib/cctpGeneration';

// « Générer le CCTP » : l'architecte choisit les pièces de l'affaire (plans
// du DCE, notice, programme) et le moteur, puis reçoit une proposition de
// lots/chapitres/articles que l'éditeur ajoute à la suite de l'arbre existant.
// Rien n'est enregistré ici : la proposition passe par l'enregistrement
// habituel du CCTP, après relecture.

interface ProjectDocument { id: string; name: string; phase?: string | null; category?: string | null }

interface EnginesState {
  parser: 'local' | 'nomic';
  engines: { engine: CctpGenerationEngine; available: boolean }[];
}

interface Props {
  projectId: string;
  onClose: () => void;
  onGenerated: (lots: GeneratedLot[], engine: CctpGenerationEngine) => void;
}

const LISIBLES = /\.(pdf|docx|pptx|xlsx|png|jpe?g|tiff?|webp|txt|csv)$/i;

export const CctpGenerateDialog: React.FC<Props> = ({ projectId, onClose, onGenerated }) => {
  const [documents, setDocuments] = useState<ProjectDocument[] | null>(null);
  const [engines, setEngines] = useState<EnginesState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<CctpGenerationEngine>('llm');
  const [instructions, setInstructions] = useState('');
  const [running, setRunning] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<ProjectDocument[]>(`/api/documents?project_id=${encodeURIComponent(projectId)}`),
      apiFetch<EnginesState>('/api/cctp/generation-engines'),
    ])
      .then(([docs, eng]) => {
        setDocuments((docs || []).filter(d => LISIBLES.test(d.name || '')));
        setEngines(eng);
      })
      .catch((e: any) => setErreur(e.message ?? 'Chargement impossible'));
  }, [projectId]);

  const nomicDisponible = !!engines?.engines.find(e => e.engine === 'nomic')?.available;

  const toggle = (id: string) => setSelected(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  const generer = async () => {
    setRunning(true);
    setErreur(null);
    try {
      const res = await apiFetch<{ lots: GeneratedLot[]; ignored?: string[] }>(`/api/projects/${encodeURIComponent(projectId)}/cctp/generate`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: [...selected], engine, instructions }),
      });
      if (!res.lots?.length) {
        setErreur("Aucun ouvrage n'a pu être déduit des pièces sélectionnées.");
        return;
      }
      onGenerated(res.lots, engine);
    } catch (e: any) {
      setErreur(e.message ?? 'Échec de la génération');
    } finally {
      setRunning(false);
    }
  };

  const label = 'block text-[0.6875rem] font-semibold text-zinc-500 uppercase tracking-wide mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={running ? undefined : onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold">Générer le CCTP à partir des pièces de l'affaire</h2>
          <button onClick={onClose} disabled={running} className="text-zinc-400 hover:text-zinc-700"><IconX size={18} /></button>
        </div>

        {erreur && (
          <div className="mx-5 mt-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{erreur}</span>
          </div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <span className={label}>Pièces à lire (10 au plus)</span>
            {documents === null ? (
              <IconLoader2 size={16} className="animate-spin text-zinc-400" />
            ) : documents.length === 0 ? (
              <p className="text-xs text-zinc-500">Aucun document lisible dans cette affaire. Déposez d'abord les plans du DCE dans l'onglet Documents.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded divide-y divide-zinc-100 dark:divide-zinc-800">
                {documents.map(d => (
                  <li key={d.id}>
                    <label className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        disabled={!selected.has(d.id) && selected.size >= 10}
                        onChange={() => toggle(d.id)}
                      />
                      <span className="truncate flex-1">{d.name}</span>
                      {d.phase && <span className="text-[0.6875rem] text-zinc-400 shrink-0">{d.phase}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className={label}>Moteur</span>
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input type="radio" name="cctp-engine" checked={engine === 'llm'} onChange={() => setEngine('llm')} className="mt-0.5" />
                <span>
                  <span className="font-semibold">IA de la plateforme</span>
                  <span className="block text-zinc-500">
                    Pièces lues par {engines?.parser === 'nomic' ? 'Nomic Parse' : 'le moteur local'}, CCTP rédigé par le modèle IA actif.
                    Décompté des crédits IA du cabinet.
                  </span>
                </span>
              </label>
              <label className={`flex items-start gap-2 text-xs ${nomicDisponible ? 'cursor-pointer' : 'opacity-50'}`}>
                <input type="radio" name="cctp-engine" checked={engine === 'nomic'} disabled={!nomicDisponible} onChange={() => setEngine('nomic')} className="mt-0.5" />
                <span>
                  <span className="font-semibold">Nomic</span>
                  <span className="block text-zinc-500">
                    {nomicDisponible
                      ? 'Lecture directe des plans et extraction structurée par Nomic, spécialisé dans les pièces d’ingénierie.'
                      : 'Non configuré sur cette instance.'}
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="cctp-instructions">Consignes (facultatif)</label>
            <textarea
              id="cctp-instructions"
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Ex. : réhabilitation BBC, lots séparés pour l'isolation par l'extérieur, menuiseries bois."
              className="w-full text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1.5"
            />
          </div>

          <p className="text-[0.6875rem] text-zinc-500">
            Les lots proposés s'ajoutent à la suite du CCTP existant, marqués « IA ». Relisez-les avant d'enregistrer :
            quantités et prix restent à renseigner.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button onClick={onClose} disabled={running} className="px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 text-xs">Annuler</button>
          <button
            onClick={generer}
            disabled={running || selected.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-semibold"
          >
            {running ? <IconLoader2 size={14} className="animate-spin" /> : <IconSparkles size={14} />}
            {running ? 'Génération en cours…' : 'Générer'}
          </button>
        </div>
      </div>
    </div>
  );
};
