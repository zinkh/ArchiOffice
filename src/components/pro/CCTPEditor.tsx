import React, { useState } from 'react';
import {
  IconPlus, IconTrash, IconChevronRight, IconChevronDown,
  IconLayoutSidebar, IconDeviceFloppy, IconTag,
} from '@tabler/icons-react';
import { DPGF, Chapitre, Ligne } from '../../types/dpgf';

interface CCTPEditorProps {
  dpgf: DPGF;
  onChange: (dpgf: DPGF) => void;
  onSave: () => void;
}

let _uid = 0;
const uid = () => `cctp_${Date.now()}_${_uid++}`;

type Selection =
  | { kind: 'lot'; lotIdx: number }
  | { kind: 'chapitre'; lotIdx: number; chapIdx: number }
  | { kind: 'ligne'; lotIdx: number; chapIdx: number; ligneIdx: number };

export const CCTPEditor: React.FC<CCTPEditorProps> = ({ dpgf, onChange, onSave }) => {
  const [showTree, setShowTree] = useState(true);
  const [expandedLots, setExpandedLots] = useState<Set<string>>(
    new Set(dpgf.lots.map(l => l.id))
  );
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(
    new Set(dpgf.lots.flatMap(l => l.chapitres.map(c => c.id)))
  );
  const [selection, setSelection] = useState<Selection | null>(null);

  // ── Mutation helper ───────────────────────────────────────────────────────
  const mutateDPGF = (fn: (d: DPGF) => void) => {
    const copy: DPGF = JSON.parse(JSON.stringify(dpgf));
    fn(copy);
    onChange(copy);
  };

  const toggleLot = (id: string) => setExpandedLots(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const toggleChap = (id: string) => setExpandedChaps(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  // ── Add CCTP-only items ───────────────────────────────────────────────────
  const addCCTPChapitre = (lotIdx: number) => {
    const lot = dpgf.lots[lotIdx];
    const newChap: Chapitre = {
      id: uid(),
      numero: `${lot.numero}.${lot.chapitres.length + 1}`,
      titre: 'Nouveau chapitre CCTP',
      lignes: [],
      cctpOnly: true,
      cctpDescription: '',
    };
    mutateDPGF(d => d.lots[lotIdx].chapitres.push(newChap));
    setExpandedLots(prev => new Set([...prev, lot.id]));
    setSelection({ kind: 'chapitre', lotIdx, chapIdx: lot.chapitres.length });
  };

  const addCCTPLigne = (lotIdx: number, chapIdx: number) => {
    const chap = dpgf.lots[lotIdx].chapitres[chapIdx];
    const newLigne: Ligne = {
      id: uid(),
      numero: `${chap.numero}.${chap.lignes.length + 1}`,
      designation: 'Nouvel article CCTP',
      unite: '',
      quantite: 0,
      prixUnitaire: 0,
      prixTotal: 0,
      type: 'ouvrage',
      cctpOnly: true,
      cctpDescription: '',
      children: [],
    };
    mutateDPGF(d => d.lots[lotIdx].chapitres[chapIdx].lignes.push(newLigne));
    setExpandedChaps(prev => new Set([...prev, chap.id]));
    setSelection({ kind: 'ligne', lotIdx, chapIdx, ligneIdx: chap.lignes.length });
  };

  // ── Delete CCTP-only items ────────────────────────────────────────────────
  const deleteCCTPChapitre = (lotIdx: number, chapIdx: number) => {
    mutateDPGF(d => d.lots[lotIdx].chapitres.splice(chapIdx, 1));
    setSelection(null);
  };

  const deleteCCTPLigne = (lotIdx: number, chapIdx: number, ligneIdx: number) => {
    mutateDPGF(d => d.lots[lotIdx].chapitres[chapIdx].lignes.splice(ligneIdx, 1));
    setSelection(null);
  };

  // ── Update description ────────────────────────────────────────────────────
  const updateDescription = (desc: string) => {
    if (!selection) return;
    mutateDPGF(d => {
      if (selection.kind === 'lot') {
        (d.lots[selection.lotIdx] as any).cctpDescription = desc;
      } else if (selection.kind === 'chapitre') {
        d.lots[selection.lotIdx].chapitres[selection.chapIdx].cctpDescription = desc;
      } else {
        d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes[selection.ligneIdx].cctpDescription = desc;
      }
    });
  };

  // ── Update name (CCTP-only items only) ───────────────────────────────────
  const updateName = (name: string) => {
    if (!selection) return;
    mutateDPGF(d => {
      if (selection.kind === 'chapitre') {
        d.lots[selection.lotIdx].chapitres[selection.chapIdx].titre = name;
      } else if (selection.kind === 'ligne') {
        d.lots[selection.lotIdx].chapitres[selection.chapIdx].lignes[selection.ligneIdx].designation = name;
      }
    });
  };

  // ── Derive selected data ──────────────────────────────────────────────────
  const getSelectedData = () => {
    if (!selection) return null;
    if (selection.kind === 'lot') {
      const lot = dpgf.lots[selection.lotIdx];
      return { label: 'Lot', name: `${lot.numero} — ${lot.titre}`, cctpOnly: false, description: (lot as any).cctpDescription ?? '', ligne: null };
    }
    if (selection.kind === 'chapitre') {
      const chap = dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx];
      if (!chap) return null;
      return { label: 'Chapitre', name: `${chap.numero} — ${chap.titre}`, cctpOnly: !!chap.cctpOnly, description: chap.cctpDescription ?? '', ligne: null };
    }
    const chap = dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx];
    const ligne = chap?.lignes[selection.ligneIdx];
    if (!ligne) return null;
    return { label: 'Article', name: `${ligne.numero} — ${ligne.designation}`, cctpOnly: !!ligne.cctpOnly, description: ligne.cctpDescription ?? '', ligne };
  };

  const selData = getSelectedData();
  const isSelCctpOnly = selData?.cctpOnly ?? false;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-900">

      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#edf1f7] dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
        <button
          onClick={() => setShowTree(v => !v)}
          title={showTree ? "Masquer l'arbre" : "Afficher l'arbre"}
          className={`p-1.5 rounded border transition-colors ${
            showTree
              ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 text-blue-700 dark:text-blue-300'
              : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:border-blue-300'
          }`}
        >
          <IconLayoutSidebar size={16} />
        </button>
        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
          CCTP — Cahier des Clauses Techniques Particulières
        </span>
        <div className="ml-auto">
          <button
            onClick={onSave}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition-colors"
          >
            <IconDeviceFloppy size={14} />
            Enregistrer
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left tree panel ────────────────────────────────────────────── */}
        {showTree && (
          <div className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-700 overflow-y-auto bg-[#f5f7fa] dark:bg-zinc-800/50 text-sm select-none">
            <div className="px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
              Structure
            </div>

            {dpgf.lots.map((lot, li) => (
              <div key={lot.id}>
                {/* Lot row */}
                <div
                  onClick={() => setSelection({ kind: 'lot', lotIdx: li })}
                  className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors ${
                    selection?.kind === 'lot' && selection.lotIdx === li
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                      : 'text-zinc-700 dark:text-zinc-200'
                  }`}
                >
                  <button
                    className="shrink-0 text-zinc-500"
                    onClick={e => { e.stopPropagation(); toggleLot(lot.id); }}
                  >
                    {expandedLots.has(lot.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </button>
                  <span className="font-bold text-zinc-500 text-xs mr-1">{lot.numero}</span>
                  <span className="truncate text-xs font-semibold flex-1">{lot.titre || 'Lot sans titre'}</span>
                </div>

                {expandedLots.has(lot.id) && (
                  <>
                    {lot.chapitres.map((chap, ci) => (
                      <div key={chap.id}>
                        {/* Chapitre row */}
                        <div
                          onClick={() => setSelection({ kind: 'chapitre', lotIdx: li, chapIdx: ci })}
                          className={`flex items-center gap-1 pl-6 pr-2 py-1 cursor-pointer hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors ${
                            selection?.kind === 'chapitre' && selection.lotIdx === li && selection.chapIdx === ci
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'text-zinc-600 dark:text-zinc-300'
                          } ${chap.cctpOnly ? 'italic' : ''}`}
                        >
                          <button
                            className="shrink-0 text-zinc-400"
                            onClick={e => { e.stopPropagation(); toggleChap(chap.id); }}
                          >
                            {expandedChaps.has(chap.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                          </button>
                          <span className="font-medium text-zinc-400 text-xs mr-1">{chap.numero}</span>
                          <span className="truncate text-xs flex-1">{chap.titre || 'Sans titre'}</span>
                          {chap.cctpOnly && (
                            <span className="shrink-0 ml-1 text-[9px] px-1 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 rounded font-bold uppercase">
                              CCTP
                            </span>
                          )}
                          {chap.cctpOnly && (
                            <button
                              onClick={e => { e.stopPropagation(); deleteCCTPChapitre(li, ci); }}
                              className="shrink-0 ml-1 text-zinc-300 hover:text-red-500 transition-colors"
                              title="Supprimer"
                            >
                              <IconTrash size={11} />
                            </button>
                          )}
                        </div>

                        {expandedChaps.has(chap.id) && (
                          <>
                            {chap.lignes.map((ligne, lgi) => (
                              <div
                                key={ligne.id}
                                onClick={() => setSelection({ kind: 'ligne', lotIdx: li, chapIdx: ci, ligneIdx: lgi })}
                                className={`flex items-center gap-1 pl-12 pr-2 py-0.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-zinc-700 transition-colors ${
                                  selection?.kind === 'ligne' && selection.lotIdx === li && selection.chapIdx === ci && selection.ligneIdx === lgi
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                    : 'text-zinc-500 dark:text-zinc-400'
                                } ${ligne.cctpOnly ? 'italic' : ''}`}
                              >
                                <span className="font-medium text-zinc-400 text-[10px] mr-1 shrink-0">{ligne.numero}</span>
                                <span className="truncate text-[11px] flex-1">{ligne.designation}</span>
                                {ligne.cctpOnly && (
                                  <span className="shrink-0 ml-1 text-[9px] px-1 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 rounded font-bold uppercase">
                                    CCTP
                                  </span>
                                )}
                                {ligne.cctpOnly && (
                                  <button
                                    onClick={e => { e.stopPropagation(); deleteCCTPLigne(li, ci, lgi); }}
                                    className="shrink-0 ml-1 text-zinc-300 hover:text-red-500 transition-colors"
                                    title="Supprimer"
                                  >
                                    <IconTrash size={10} />
                                  </button>
                                )}
                              </div>
                            ))}

                            {/* Add CCTP-only article under this chapter */}
                            <button
                              onClick={() => addCCTPLigne(li, ci)}
                              className="w-full flex items-center gap-1 pl-12 pr-2 py-0.5 text-[10px] text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                            >
                              <IconPlus size={10} />
                              <span>Article CCTP</span>
                            </button>
                          </>
                        )}
                      </div>
                    ))}

                    {/* Add CCTP-only chapter under this lot */}
                    <button
                      onClick={() => addCCTPChapitre(li)}
                      className="w-full flex items-center gap-1 pl-6 pr-2 py-1 text-[10px] text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                    >
                      <IconPlus size={10} />
                      <span>Chapitre CCTP</span>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Right content panel ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {!selection || !selData ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400 dark:text-zinc-500">
              <span className="text-5xl">📋</span>
              <p className="text-sm font-medium">Sélectionnez un élément dans l'arbre</p>
              <p className="text-xs">Lot, chapitre ou article pour saisir sa description CCTP</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-6 space-y-6">

              {/* Item header */}
              <div className="border-b border-zinc-200 dark:border-zinc-700 pb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                    {selData.label}
                  </span>
                  {isSelCctpOnly && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 rounded-full font-bold uppercase">
                      <IconTag size={9} />
                      CCTP uniquement
                    </span>
                  )}
                </div>

                {isSelCctpOnly && selection && selection.kind !== 'lot' ? (
                  <input
                    type="text"
                    value={
                      selection.kind === 'chapitre'
                        ? dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx]?.titre ?? ''
                        : dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx]?.lignes[selection.ligneIdx]?.designation ?? ''
                    }
                    onChange={e => updateName(e.target.value)}
                    className="text-xl font-bold w-full bg-transparent border-b-2 border-zinc-200 dark:border-zinc-600 focus:border-blue-500 outline-none pb-1 text-zinc-900 dark:text-white transition-colors"
                    placeholder="Titre…"
                  />
                ) : (
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{selData.name}</h2>
                )}

                {/* DPGF article info badge */}
                {selection.kind === 'ligne' && !isSelCctpOnly && (() => {
                  const l = dpgf.lots[selection.lotIdx]?.chapitres[selection.chapIdx]?.lignes[selection.ligneIdx];
                  if (!l) return null;
                  return (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {l.unite && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500">
                          Unité : <strong>{l.unite}</strong>
                        </span>
                      )}
                      {l.quantite > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500">
                          Qté : <strong>{l.quantite}</strong>
                        </span>
                      )}
                      {l.prixUnitaire > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500">
                          P.U. HT : <strong>{l.prixUnitaire.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</strong>
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Description CCTP */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                  Description technique
                </label>
                <textarea
                  value={selData.description}
                  onChange={e => updateDescription(e.target.value)}
                  rows={16}
                  placeholder={`Rédigez ici la description technique de ce ${selData.label.toLowerCase()}…\n\nEx : matériaux, mise en œuvre, prescriptions, normes applicables (NF EN…), conditions d'exécution, essais, réception…`}
                  className="w-full px-4 py-3 text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y leading-relaxed font-sans"
                />
                <p className="text-[11px] text-zinc-400">
                  Ce texte apparaît uniquement dans le document CCTP, pas dans le DPGF.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
