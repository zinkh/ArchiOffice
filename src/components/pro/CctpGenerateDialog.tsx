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

interface PlannedLot { titre: string; perimetre: string }

// Lots rédigés en parallèle : le plan a déjà mis les pièces en cache chez le
// fournisseur, quelques appels simultanés en profitent sans saturer la limite.
const LOT_CONCURRENCY = 3;

const LISIBLES = /\.(pdf|docx|pptx|xlsx|png|jpe?g|tiff?|webp|txt|csv)$/i;

export const CctpGenerateDialog: React.FC<Props> = ({ projectId, onClose, onGenerated }) => {
  const [documents, setDocuments] = useState<ProjectDocument[] | null>(null);
  const [engines, setEngines] = useState<EnginesState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<CctpGenerationEngine>('llm');
  const [instructions, setInstructions] = useState('');
  const [running, setRunning] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string[] } | null>(null);
  // Reprise après un échec partiel : plan et lots déjà rédigés.
  const [partial, setPartial] = useState<{ plan: PlannedLot[]; results: (GeneratedLot | null)[] } | null>(null);

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

  const body = () => ({ document_ids: [...selected], instructions });
  const base = `/api/projects/${encodeURIComponent(projectId)}/cctp`;

  // Rédige les lots d'`indexes`, LOT_CONCURRENCY à la fois, en gardant leur place.
  const redigerLots = async (plan: PlannedLot[], results: (GeneratedLot | null)[], indexes: number[]) => {
    const queue = [...indexes];
    const enCours = new Set<string>();
    let done = results.filter(Boolean).length;
    const maj = () => setProgress({ done, total: plan.length, current: [...enCours] });
    maj();
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        const lot = plan[i];
        enCours.add(lot.titre); maj();
        try {
          const res = await apiFetch<{ lot: GeneratedLot }>(`${base}/generate-lot`, {
            method: 'POST',
            body: JSON.stringify({ ...body(), lot, other_lots: plan.map(l => l.titre) }),
          });
          results[i] = res.lot;
          done++;
        } catch {
          results[i] = null;
        } finally {
          enCours.delete(lot.titre); maj();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOT_CONCURRENCY, queue.length) }, worker));
  };

  const terminer = (plan: PlannedLot[], results: (GeneratedLot | null)[]) => {
    const manquants = plan.filter((_, i) => !results[i]).map(l => l.titre);
    if (manquants.length === 0) {
      setPartial(null);
      onGenerated(results.filter((l): l is GeneratedLot => !!l), 'llm');
      return;
    }
    setPartial({ plan, results });
    setErreur(`${manquants.length} lot(s) n'ont pas pu être rédigés : ${manquants.join(', ')}. Réessayez-les ou insérez ceux qui ont abouti.`);
  };

  const generer = async () => {
    setRunning(true);
    setErreur(null);
    setPartial(null);
    try {
      if (engine === 'nomic') {
        const res = await apiFetch<{ lots: GeneratedLot[]; ignored?: string[] }>(`${base}/generate`, {
          method: 'POST',
          body: JSON.stringify({ ...body(), engine }),
        });
        if (!res.lots?.length) {
          setErreur("Aucun ouvrage n'a pu être déduit des pièces sélectionnées.");
          return;
        }
        onGenerated(res.lots, engine);
        return;
      }
      // Moteur IA : plan (liste des lots), puis un appel court par lot.
      setProgress({ done: 0, total: 0, current: ['Lecture des pièces et plan des lots'] });
      const { lots: plan } = await apiFetch<{ lots: PlannedLot[] }>(`${base}/plan`, { method: 'POST', body: JSON.stringify(body()) });
      if (!plan?.length) {
        setErreur("Aucun ouvrage n'a pu être déduit des pièces sélectionnées.");
        return;
      }
      const results: (GeneratedLot | null)[] = plan.map(() => null);
      await redigerLots(plan, results, plan.map((_, i) => i));
      terminer(plan, results);
    } catch (e: any) {
      setErreur(e.message ?? 'Échec de la génération');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const reessayer = async () => {
    if (!partial) return;
    setRunning(true);
    setErreur(null);
    try {
      const results = [...partial.results];
      await redigerLots(partial.plan, results, partial.plan.map((_, i) => i).filter(i => !results[i]));
      terminer(partial.plan, results);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const insererObtenus = () => {
    if (!partial) return;
    onGenerated(partial.results.filter((l): l is GeneratedLot => !!l), 'llm');
  };

  const label = 'block text-[0.6875rem] font-semibold text-zinc-500 uppercase tracking-wide mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={running ? undefined : onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col" onClick={e => e.stopPropagation()}>
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

          {running && progress && (
            <div role="status" className="text-xs text-zinc-600 dark:text-zinc-300">
              {progress.total > 0 && (
                <>
                  <div className="h-1.5 rounded bg-zinc-200 dark:bg-zinc-700 overflow-hidden mb-1">
                    <div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                  <div>Lot{progress.done > 1 ? 's' : ''} rédigé{progress.done > 1 ? 's' : ''} : {progress.done} sur {progress.total}</div>
                </>
              )}
              {progress.current.length > 0 && <div className="text-zinc-500 truncate">En cours : {progress.current.join(' · ')}</div>}
            </div>
          )}

          <p className="text-[0.6875rem] text-zinc-500">
            Les lots proposés s'ajoutent à la suite du CCTP existant, marqués « IA ». Relisez-les avant d'enregistrer :
            quantités et prix restent à renseigner.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button onClick={onClose} disabled={running} className="px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 text-xs">Annuler</button>
          {partial && !running && (
            <button onClick={insererObtenus} className="px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 text-xs">
              Insérer les lots obtenus
            </button>
          )}
          <button
            onClick={partial ? reessayer : generer}
            disabled={running || selected.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-semibold"
          >
            {running ? <IconLoader2 size={14} className="animate-spin" /> : <IconSparkles size={14} />}
            {running ? 'Génération en cours…' : partial ? 'Réessayer les lots en échec' : 'Générer'}
          </button>
        </div>
      </div>
    </div>
  );
};
