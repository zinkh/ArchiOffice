import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { IconX, IconSearch, IconPlus, IconStar, IconStarFilled, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import type { BPULigne } from '../../types/bpu';

/** Une ligne d'articles_type, la bibliothèque de prix du cabinet. */
export interface ArticleType {
  id: string;
  code?: string;
  designation: string;
  unite: string;
  prix_unitaire: number;
  categorie?: string;
  lot_type?: string;
  description?: string;
  source?: string;
  date_prix?: string;
  usage_count?: number;
  favori?: boolean;
  notes?: string;
}

interface Props {
  onClose: () => void;
  /** Insère les articles cochés dans le chapitre courant du bordereau. */
  onInsert: (lignes: Omit<BPULigne, 'id'>[]) => void;
  /** Vrai quand un chapitre est sélectionné : sans lui on ne sait pas où insérer. */
  canInsert: boolean;
}

export const PriceLibraryPanel: React.FC<Props> = ({ onClose, onInsert, canInsert }) => {
  const [q, setQ] = useState('');
  const [categorie, setCategorie] = useState('');
  const [lotType, setLotType] = useState('');
  const [items, setItems] = useState<ArticleType[]>([]);
  const [facettes, setFacettes] = useState<{ categories: string[]; lotTypes: string[] }>({ categories: [], lotTypes: [] });
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch<{ categories: string[]; lotTypes: string[] }>('/api/price-library/categories')
      .then(setFacettes).catch(() => { /* facettes optionnelles */ });
  }, []);

  // La recherche est côté serveur : une bibliothèque mûre fait des milliers de
  // lignes, on ne les charge pas toutes à chaque frappe.
  const rechercher = useCallback(async () => {
    setChargement(true); setErreur(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (categorie) params.set('categorie', categorie);
      if (lotType) params.set('lot_type', lotType);
      params.set('limit', '80');
      setItems(await apiFetch<ArticleType[]>(`/api/price-library?${params}`));
    } catch (e: any) {
      setErreur(e?.message || 'La bibliothèque est indisponible.');
    } finally {
      setChargement(false);
    }
  }, [q, categorie, lotType]);

  // Débounce court : la frappe ne doit pas déclencher un appel par caractère.
  useEffect(() => {
    const t = setTimeout(rechercher, 250);
    return () => clearTimeout(t);
  }, [rechercher]);

  const selection = useMemo(() => items.filter(i => coches.has(i.id)), [items, coches]);

  const inserer = () => {
    if (!selection.length) return;
    onInsert(selection.map(a => ({
      numero: a.code ?? '',
      designation: a.designation,
      unite: a.unite || 'u',
      quantite: 0,
      prixUnitaire: a.prix_unitaire ?? 0,
      prixTotal: 0,
      type: 'ouvrage' as const,
      nature: 'base' as const,
      articleTypeId: a.id,   // provenance, pour pouvoir remonter les prix plus tard
    })));
    // Le compteur d'usage est ce qui fait remonter les articles réellement
    // employés : envoyé sans attendre la réponse.
    for (const a of selection) {
      void apiFetch(`/api/price-library/${a.id}/used`, { method: 'POST' }).catch(() => {});
    }
    setCoches(new Set());
  };

  const basculerFavori = async (a: ArticleType) => {
    const favori = !a.favori;
    setItems(prev => prev.map(i => i.id === a.id ? { ...i, favori } : i));
    try {
      await apiFetch(`/api/price-library/${a.id}`, { method: 'PUT', body: JSON.stringify({ ...a, favori }) });
    } catch {
      setItems(prev => prev.map(i => i.id === a.id ? { ...i, favori: !favori } : i));
    }
  };

  const champ = 'px-2 py-1 text-xs border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none';

  return (
    <div className="w-80 shrink-0 border-l border-zinc-200 dark:border-zinc-700 bg-[#f9fafb] dark:bg-zinc-800/30 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Bibliothèque de prix</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={14} /></button>
      </div>

      <div className="p-2 space-y-2 border-b border-zinc-200 dark:border-zinc-700">
        <div className="relative">
          <IconSearch size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input className={`${champ} w-full pl-7`} placeholder="Rechercher une désignation…"
                 value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          <select className={`${champ} flex-1`} value={categorie} onChange={e => setCategorie(e.target.value)}>
            <option value="">Toutes catégories</option>
            {facettes.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={`${champ} flex-1`} value={lotType} onChange={e => setLotType(e.target.value)}>
            <option value="">Tous corps d'état</option>
            {facettes.lotTypes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chargement && (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-zinc-400">
            <IconLoader2 size={14} className="animate-spin" /> Recherche…
          </div>
        )}
        {erreur && <div className="p-4 text-xs text-red-600">{erreur}</div>}
        {!chargement && !erreur && items.length === 0 && (
          <div className="p-4 text-xs text-zinc-400">
            {q || categorie || lotType
              ? 'Aucun article ne correspond.'
              : "La bibliothèque est vide. Sélectionnez des articles dans le bordereau puis « Envoyer » depuis le ruban pour la constituer."}
          </div>
        )}

        {items.map(a => (
          <div key={a.id}
               className={`px-2 py-1.5 border-b border-zinc-100 dark:border-zinc-800 text-xs cursor-pointer
                 ${coches.has(a.id) ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-white dark:hover:bg-zinc-800/60'}`}
               onClick={() => setCoches(prev => {
                 const s = new Set(prev); s.has(a.id) ? s.delete(a.id) : s.add(a.id); return s;
               })}>
            <div className="flex items-start gap-1.5">
              <input type="checkbox" className="mt-0.5" checked={coches.has(a.id)} readOnly />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-zinc-700 dark:text-zinc-300">{a.designation}</div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                  <span>{a.unite}</span>
                  <span className="font-mono text-[#1e5090]">{formatCurrency(a.prix_unitaire ?? 0)}</span>
                  {a.lot_type && <span className="truncate">{a.lot_type}</span>}
                  {/* Sans date, impossible de juger la fraîcheur d'un prix. */}
                  {a.date_prix && <span>{new Date(a.date_prix).getFullYear()}</span>}
                  {!!a.usage_count && <span>· {a.usage_count}×</span>}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); void basculerFavori(a); }}
                      className="text-amber-400 hover:text-amber-500 shrink-0">
                {a.favori ? <IconStarFilled size={12} /> : <IconStar size={12} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-zinc-200 dark:border-zinc-700">
        <button
          onClick={inserer}
          disabled={!selection.length || !canInsert}
          title={canInsert ? undefined : 'Sélectionnez d’abord un chapitre dans le bordereau'}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <IconPlus size={13} />
          Insérer {selection.length > 0 && `(${selection.length})`}
        </button>
      </div>
    </div>
  );
};
