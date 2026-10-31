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
  // Étape 2 du moteur IA : lots proposés par le plan, que l'architecte coche
  // avant toute rédaction (chaque lot rédigé est facturé).
  const [proposition, setProposition] = useState<{ plan: PlannedLot[]; coches: Set<number> } | null>(null);
  // Reprise après un échec partiel : plan, lots visés (`cibles`) et lots déjà rédigés.
  const [partial, setPartial] = useState<{ plan: PlannedLot[]; results: (GeneratedLot | null)[]; cibles: number[] } | null>(null);

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
  // `cibles` : tous les lots visés par la demande (cochés), pour la progression.
  const redigerLots = async (plan: PlannedLot[], results: (GeneratedLot | null)[], indexes: number[], cibles: number[]) => {
    const queue = [...indexes];
    const enCours = new Set<string>();
    let done = cibles.filter(i => results[i]).length;
    const maj = () => setProgress({ done, total: cibles.length, current: [...enCours] });
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

  const terminer = (plan: PlannedLot[], results: (GeneratedLot | null)[], cibles: number[]) => {
    const manquants = cibles.filter(i => !results[i]).map(i => plan[i].titre);
    if (manquants.length === 0) {
      setPartial(null);
      onGenerated(results.filter((l): l is GeneratedLot => !!l), 'llm');
      return;
    }
    setPartial({ plan, results, cibles });
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
      // Moteur IA : lecture des pièces une par une (une requête courte chacune,
      // l'OCR d'un plan scanné pouvant dépasser le délai de la passerelle si elle
      // partageait la requête du plan), puis le plan, puis un appel court par lot.
      // Une pièce dont la lecture échoue ici n'arrête rien : le plan retentera.
      const aLire = (documents ?? []).filter(d => selected.has(d.id));
      for (let i = 0; i < aLire.length; i++) {
        setProgress({ done: 0, total: 0, current: [`Lecture de ${aLire[i].name} (${i + 1}/${aLire.length})`] });
        try {
          await apiFetch(`${base}/read-piece`, { method: 'POST', body: JSON.stringify({ document_id: aLire[i].id }) });
        } catch { /* le plan relira cette pièce */ }
      }
      setProgress({ done: 0, total: 0, current: ['Plan des lots'] });
      const { lots: plan } = await apiFetch<{ lots: PlannedLot[] }>(`${base}/plan`, { method: 'POST', body: JSON.stringify(body()) });
      if (!plan?.length) {
        setErreur("Aucun ouvrage n'a pu être déduit des pièces sélectionnées.");
        return;
      }
      // Le plan s'arrête ici : l'architecte coche les lots à rédiger (tous cochés au départ).
      setProposition({ plan, coches: new Set(plan.map((_, i) => i)) });
    } catch (e: any) {
      setErreur(e.message ?? 'Échec de la génération');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const basculerLot = (i: number) => setProposition(p => {
    if (!p) return p;
    const coches = new Set(p.coches); coches.has(i) ? coches.delete(i) : coches.add(i);
    return { ...p, coches };
  });

  const toutCocher = (cocher: boolean) => setProposition(p => (p ? { ...p, coches: new Set(cocher ? p.plan.map((_, i) => i) : []) } : p));

  const redigerCoches = async () => {
    if (!proposition || proposition.coches.size === 0) return;
    const { plan } = proposition;
    const cibles = [...proposition.coches].sort((a, b) => a - b);
    setRunning(true);
    setErreur(null);
    setPartial(null);
    try {
      const results: (GeneratedLot | null)[] = plan.map(() => null);
      await redigerLots(plan, results, cibles, cibles);
      terminer(plan, results, cibles);
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
      await redigerLots(partial.plan, results, partial.cibles.filter(i => !results[i]), partial.cibles);
      terminer(partial.plan, results, partial.cibles);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const modifierPieces = () => {
    setProposition(null);
    setPartial(null);
    setErreur(null);
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
          {proposition ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`${label} mb-0`}>Lots à rédiger</span>
                {!partial && (
                  <span className="flex items-center gap-3 text-[0.6875rem]">
                    <button type="button" disabled={running} onClick={() => toutCocher(true)} className="text-blue-600 hover:underline disabled:opacity-50">Tout cocher</button>
                    <button type="button" disabled={running} onClick={() => toutCocher(false)} className="text-blue-600 hover:underline disabled:opacity-50">Tout décocher</button>
                  </span>
                )}
              </div>
              <ul className="max-h-72 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded divide-y divide-zinc-100 dark:divide-zinc-800">
                {proposition.plan.map((lot, i) => {
                  const redige = !!partial?.results[i];
                  const echec = !!partial && partial.cibles.includes(i) && !partial.results[i];
                  return (
                    <li key={i}>
                      <label className={`flex items-start gap-2 px-3 py-1.5 text-xs ${partial || running ? '' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={proposition.coches.has(i)}
                          disabled={running || !!partial}
                          onChange={() => basculerLot(i)}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="font-semibold">{lot.titre}</span>
                          {lot.perimetre && <span className="block text-zinc-500">{lot.perimetre}</span>}
                        </span>
                        {redige && <span className="text-[0.6875rem] text-green-700 shrink-0">Rédigé</span>}
                        {echec && <span className="text-[0.6875rem] text-red-700 shrink-0">Échec</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5 text-[0.6875rem] text-zinc-500">
                {proposition.coches.size} lot{proposition.coches.size > 1 ? 's' : ''} sur {proposition.plan.length} à rédiger.
                Chaque lot rédigé est décompté des crédits IA du cabinet ; les lots décochés ne sont pas rédigés.
              </p>
              {!running && (
                <button type="button" onClick={modifierPieces} className="mt-2 text-[0.6875rem] text-blue-600 hover:underline">
                  Modifier les pièces ou les consignes
                </button>
              )}
            </div>
          ) : (<>
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
          </>)}

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
            onClick={partial ? reessayer : proposition ? redigerCoches : generer}
            disabled={running || (proposition && !partial ? proposition.coches.size === 0 : selected.size === 0)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-semibold"
          >
            {running ? <IconLoader2 size={14} className="animate-spin" /> : <IconSparkles size={14} />}
            {running
              ? 'Génération en cours…'
              : partial
                ? 'Réessayer les lots en échec'
                : proposition
                  ? `Rédiger ${proposition.coches.size} lot${proposition.coches.size > 1 ? 's' : ''}`
                  : engine === 'llm' ? 'Lister les lots' : 'Générer'}
          </button>
        </div>
      </div>
    </div>
  );
};
