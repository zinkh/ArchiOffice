import React, { useState } from 'react';
import { useCCTP } from '../../hooks/useCCTP';
import type { CCTP, Lot, Chapitre, Article } from '../../types/cctp';
import { cn } from '../../lib/utils';

interface CCTPEditorProps {
  projectId: string;
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyArticle(idx: number): Article {
  return { id: generateId(), numero: String(idx + 1), designation: '', description: '', unite: 'u', prescriptionsTechniques: '', normes: '' };
}

function emptyChapitre(idx: number): Chapitre {
  return { id: generateId(), numero: String(idx + 1), titre: '', articles: [emptyArticle(0)] };
}

function emptyLot(idx: number): Lot {
  return { id: generateId(), numero: String(idx + 1), titre: '', description: '', chapitres: [emptyChapitre(0)] };
}

const STATUS_LABELS: Record<string, string> = { draft: 'Brouillon', final: 'Finalisé' };

export const CCTPEditor: React.FC<CCTPEditorProps> = ({ projectId }) => {
  const { cctp, loading, saveCCTP } = useCCTP(projectId);
  const [localCCTP, setLocalCCTP] = useState<CCTP | null>(null);
  const [expandedLots, setExpandedLots] = useState<Set<string>>(new Set());
  const [expandedChaps, setExpandedChaps] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [aiLoadingLotId, setAiLoadingLotId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<{ lotId: string; articles: Article[] } | null>(null);
  const [selectedAiArticles, setSelectedAiArticles] = useState<Set<number>>(new Set());

  const data: CCTP | null = localCCTP ?? cctp;

  const update = (fn: (d: CCTP) => CCTP) => {
    setLocalCCTP(prev => {
      const base = prev ?? cctp;
      if (!base) return prev;
      return fn(JSON.parse(JSON.stringify(base)));
    });
  };

  const handleSave = async () => {
    if (!data) return;
    setIsSaving(true);
    try {
      await saveCCTP(data);
      setLocalCCTP(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = () => {
    const newCCTP: CCTP = {
      id: generateId(), projectId, titre: 'CCTP', version: '1.0',
      dateCreation: new Date().toISOString(), statut: 'draft', lots: [emptyLot(0)],
    };
    setLocalCCTP(newCCTP);
    setExpandedLots(new Set([newCCTP.lots[0].id]));
  };

  const toggleLot = (id: string) => setExpandedLots(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleChap = (id: string) => setExpandedChaps(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // AI suggestions
  const fetchAISuggestions = async (lot: Lot) => {
    setAiLoadingLotId(lot.id);
    try {
      const existingArticles = lot.chapitres.flatMap(c => c.articles.map(a => a.designation)).filter(Boolean);
      const res = await fetch('/api/ai/suggest-articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_name: lot.titre || 'Lot ' + lot.numero, existing_articles: existingArticles }),
      });
      if (res.ok) {
        const { articles } = await res.json();
        setAiSuggestions({ lotId: lot.id, articles: articles.map((a: any, i: number) => ({ ...a, id: generateId(), numero: String(i + 1) })) });
        setSelectedAiArticles(new Set(articles.map((_: any, i: number) => i)));
      } else {
        const err = await res.json();
        alert('Erreur IA : ' + (err.error || 'Inconnue'));
      }
    } catch (err: any) {
      alert('Erreur IA : ' + err.message);
    } finally {
      setAiLoadingLotId(null);
    }
  };

  const importAiArticles = () => {
    if (!aiSuggestions || !data) return;
    update(d => {
      const lot = d.lots.find(l => l.id === aiSuggestions.lotId);
      if (!lot) return d;
      const toImport = aiSuggestions.articles.filter((_, i) => selectedAiArticles.has(i));
      if (lot.chapitres.length === 0) lot.chapitres.push(emptyChapitre(0));
      lot.chapitres[0].articles.push(...toImport);
      return d;
    });
    setAiSuggestions(null);
    setSelectedAiArticles(new Set());
  };

  if (loading) return (
    <div className="flex items-center gap-2 p-8 text-zinc-500">
      <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      Chargement du CCTP...
    </div>
  );

  if (!data) return (
    <div className="space-y-8 pt-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Éditeur CCTP</h3>
          <p className="text-sm text-zinc-500 mt-1">Cahier des Clauses Techniques Particulières</p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center">
          <span className="text-3xl">📋</span>
        </div>
        <p className="text-zinc-500 text-sm">Aucun CCTP pour ce projet</p>
        <button onClick={handleCreate} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-colors">
          + Créer un CCTP
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pt-4">
      {/* AI Suggestions Modal */}
      {aiSuggestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setAiSuggestions(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <h4 className="text-base font-bold text-zinc-900 dark:text-white">Suggestions IA — Articles CCTP</h4>
              </div>
              <button onClick={() => setAiSuggestions(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
            </div>
            <p className="text-xs text-zinc-500 mb-3">Sélectionnez les articles à importer dans le lot :</p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {aiSuggestions.articles.map((art, i) => (
                <label key={i} className={cn("flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors", selectedAiArticles.has(i) ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-700' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800')}>
                  <input type="checkbox" checked={selectedAiArticles.has(i)} onChange={() => setSelectedAiArticles(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })} className="mt-0.5 accent-violet-600" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{art.designation}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{art.description}</p>
                    {art.unite && <span className="inline-block mt-1 text-[10px] px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-zinc-500">{art.unite}</span>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setAiSuggestions(null)} className="flex-1 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                Annuler
              </button>
              <button onClick={importAiArticles} disabled={selectedAiArticles.size === 0} className="flex-1 py-2 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg transition-colors">
                Importer ({selectedAiArticles.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Éditeur CCTP</h3>
          <p className="text-xs text-zinc-500 mt-1">v{data.version} · {STATUS_LABELS[data.statut] || data.statut}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={data.statut}
            onChange={e => update(d => ({ ...d, statut: e.target.value as 'draft' | 'final' }))}
            className="px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none"
          >
            <option value="draft">Brouillon</option>
            <option value="final">Finalisé</option>
          </select>
          {localCCTP && (
            <button onClick={handleSave} disabled={isSaving} className="px-4 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg transition-colors">
              {isSaving ? 'Enregistrement...' : '💾 Enregistrer'}
            </button>
          )}
        </div>
      </div>

      {/* Titre CCTP */}
      <div>
        <input
          type="text"
          value={data.titre}
          onChange={e => update(d => ({ ...d, titre: e.target.value }))}
          placeholder="Titre du CCTP"
          className="w-full text-lg font-semibold px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      {/* Lots */}
      <div className="space-y-3">
        {data.lots.map((lot, li) => (
          <div key={lot.id} className="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            {/* Lot header */}
            <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50">
              <button onClick={() => toggleLot(lot.id)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex-shrink-0">
                <span className={cn("text-sm transition-transform inline-block", expandedLots.has(lot.id) ? 'rotate-90' : '')}>▶</span>
              </button>
              <span className="text-xs font-bold text-zinc-400 uppercase w-8">Lot {lot.numero}</span>
              <input
                type="text"
                value={lot.titre}
                onChange={e => update(d => { d.lots[li].titre = e.target.value; return d; })}
                placeholder="Titre du lot (ex: Gros œuvre)"
                className="flex-1 px-3 py-1.5 text-sm font-semibold border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                onClick={e => e.stopPropagation()}
              />
              {/* AI suggestions button */}
              <button
                onClick={() => fetchAISuggestions(lot)}
                disabled={aiLoadingLotId === lot.id || !lot.titre}
                title={!lot.titre ? 'Entrez un titre de lot pour générer des suggestions' : 'Suggérer des articles via IA'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30 hover:bg-violet-200 dark:hover:bg-violet-900/50 disabled:opacity-50 rounded-lg transition-colors flex-shrink-0"
              >
                {aiLoadingLotId === lot.id ? (
                  <div className="w-3 h-3 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
                ) : '✨'}
                IA
              </button>
              <button
                onClick={() => update(d => { d.lots.splice(li, 1); return d; })}
                className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
                title="Supprimer le lot"
              >
                🗑
              </button>
            </div>

            {expandedLots.has(lot.id) && (
              <div className="p-4 space-y-3">
                <textarea
                  value={lot.description}
                  onChange={e => update(d => { d.lots[li].description = e.target.value; return d; })}
                  placeholder="Description générale du lot..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />

                {/* Chapitres */}
                {lot.chapitres.map((chap, ci) => (
                  <div key={chap.id} className="border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden ml-2">
                    <div className="flex items-center gap-2 p-3 bg-white dark:bg-zinc-900">
                      <button onClick={() => toggleChap(chap.id)} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                        <span className={cn("text-xs transition-transform inline-block", expandedChaps.has(chap.id) ? 'rotate-90' : '')}>▶</span>
                      </button>
                      <input
                        type="text"
                        value={chap.titre}
                        onChange={e => update(d => { d.lots[li].chapitres[ci].titre = e.target.value; return d; })}
                        placeholder={`Chapitre ${chap.numero} — titre`}
                        className="flex-1 px-2 py-1 text-sm font-medium border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <button
                        onClick={() => update(d => { d.lots[li].chapitres.splice(ci, 1); return d; })}
                        className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors flex-shrink-0"
                      >✕</button>
                    </div>

                    {expandedChaps.has(chap.id) && (
                      <div className="p-3 space-y-2 bg-zinc-50/50 dark:bg-zinc-900/50">
                        {chap.articles.map((art, ai) => (
                          <div key={art.id} className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-100 dark:border-zinc-700 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-zinc-400 w-6">{li+1}.{ci+1}.{ai+1}</span>
                              <input
                                type="text"
                                value={art.designation}
                                onChange={e => update(d => { d.lots[li].chapitres[ci].articles[ai].designation = e.target.value; return d; })}
                                placeholder="Désignation de l'article"
                                className="flex-1 px-2 py-1 text-sm font-medium border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                              />
                              <input
                                type="text"
                                value={art.unite}
                                onChange={e => update(d => { d.lots[li].chapitres[ci].articles[ai].unite = e.target.value; return d; })}
                                placeholder="Unité"
                                className="w-16 px-2 py-1 text-xs text-center border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-500"
                              />
                              <button
                                onClick={() => update(d => { d.lots[li].chapitres[ci].articles.splice(ai, 1); return d; })}
                                className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors"
                              >✕</button>
                            </div>
                            <textarea
                              value={art.description}
                              onChange={e => update(d => { d.lots[li].chapitres[ci].articles[ai].description = e.target.value; return d; })}
                              placeholder="Description technique..."
                              rows={2}
                              className="w-full px-2 py-1 text-xs border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                            />
                            <input
                              type="text"
                              value={art.prescriptionsTechniques}
                              onChange={e => update(d => { d.lots[li].chapitres[ci].articles[ai].prescriptionsTechniques = e.target.value; return d; })}
                              placeholder="Prescriptions techniques, normes (ex: NF EN 1337)..."
                              className="w-full px-2 py-1 text-xs border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-500"
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => update(d => { d.lots[li].chapitres[ci].articles.push(emptyArticle(chap.articles.length)); return d; })}
                          className="text-xs text-violet-600 dark:text-violet-400 hover:underline ml-1"
                        >
                          + Ajouter un article
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={() => { update(d => { d.lots[li].chapitres.push(emptyChapitre(lot.chapitres.length)); return d; }); }}
                  className="text-xs text-zinc-500 hover:text-violet-600 dark:hover:text-violet-400 hover:underline ml-4 transition-colors"
                >
                  + Ajouter un chapitre
                </button>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={() => { update(d => { d.lots.push(emptyLot(d.lots.length)); return d; }); }}
          className="w-full py-3 text-sm font-medium text-zinc-500 dark:text-zinc-400 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-2xl hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
        >
          + Ajouter un lot
        </button>
      </div>
    </div>
  );
};
