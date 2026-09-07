// ── Panneau bibliothèque d'ouvrages ──────────────────────────────────────────
// Sert les trois éditeurs — CCTP, DPGF et BPU/DQE — d'où un `onInsert` qui rend
// les ARTICLES bruts et non des lignes déjà formées : un article devient une
// ligne de DPGF (avec quantité), une ligne de BPU (sans quantité, avec nature)
// ou un article de CCTP (dont la description technique amorce le texte). Faire
// la conversion ici obligerait le panneau à connaître les trois formes.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  IconX, IconSearch, IconPlus, IconStar, IconStarFilled, IconLoader2,
} from '@tabler/icons-react';
import { apiFetch, fetchJson } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import type { ArticleBibliotheque, Referentiels } from '../../types/library';

/** Conservé pour les appelants existants ; c'est la ligne d'articles_type. */
export type ArticleType = ArticleBibliotheque;

interface Props {
  onClose: () => void;
  /** Insère les articles cochés là où l'éditeur appelant sait les mettre. */
  onInsert: (articles: ArticleBibliotheque[]) => void;
  /** Faux quand aucune cible n'est sélectionnée : on ne saurait pas où insérer. */
  canInsert: boolean;
  /** Message d'aide quand `canInsert` est faux, propre à chaque éditeur. */
  hintCible?: string;
}

export const PriceLibraryPanel: React.FC<Props> = ({ onClose, onInsert, canInsert, hintCible }) => {
  const [q, setQ] = useState('');
  const [corpsEtat, setCorpsEtat] = useState('');
  const [dtu, setDtu] = useState('');
  const [items, setItems] = useState<ArticleBibliotheque[]>([]);
  const [referentiels, setReferentiels] = useState<Referentiels | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchJson<Referentiels>('/api/referentiels')
      .then(setReferentiels)
      .catch(() => { /* les filtres de classement restent facultatifs */ });
  }, []);

  // La recherche est côté serveur : une bibliothèque mûre fait des milliers de
  // lignes, on ne les charge pas toutes à chaque frappe.
  const rechercher = useCallback(async () => {
    setChargement(true); setErreur(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (corpsEtat) params.set('corps_etat_code', corpsEtat);
      if (dtu) params.set('dtu_code', dtu);
      params.set('limit', '80');
      setItems(await apiFetch<ArticleBibliotheque[]>(`/api/price-library?${params}`));
    } catch (e: any) {
      setErreur(e?.message || 'La bibliothèque est indisponible.');
    } finally {
      setChargement(false);
    }
  }, [q, corpsEtat, dtu]);

  // Débounce court : la frappe ne doit pas déclencher un appel par caractère.
  useEffect(() => {
    const t = setTimeout(rechercher, 250);
    return () => clearTimeout(t);
  }, [rechercher]);

  const selection = useMemo(() => items.filter(i => coches.has(i.id)), [items, coches]);

  // Les DTU proposés suivent le corps d'état choisi : sur « Couverture », les
  // 115 normes se réduisent aux 19 qui concernent le métier.
  const dtuDisponibles = useMemo(() => {
    if (!referentiels) return [];
    const codes = corpsEtat ? referentiels.dtuParCorpsEtat[corpsEtat] : null;
    if (!codes) return referentiels.dtu;
    const permis = new Set(codes);
    return referentiels.dtu.filter(d => permis.has(d.code));
  }, [corpsEtat, referentiels]);

  const familles = useMemo(() => {
    const out: { famille: string; metiers: Referentiels['corpsEtat'] }[] = [];
    for (const ce of referentiels?.corpsEtat ?? []) {
      const groupe = out.find(g => g.famille === ce.famille);
      if (groupe) groupe.metiers.push(ce); else out.push({ famille: ce.famille, metiers: [ce] });
    }
    return out;
  }, [referentiels]);

  const inserer = () => {
    if (!selection.length) return;
    onInsert(selection);
    // Le compteur d'usage est ce qui fait remonter les articles réellement
    // employés : envoyé sans attendre la réponse.
    for (const a of selection) {
      void apiFetch(`/api/price-library/${a.id}/used`, { method: 'POST' }).catch(() => {});
    }
    setCoches(new Set());
  };

  const basculerFavori = async (a: ArticleBibliotheque) => {
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Bibliothèque d’ouvrages</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={14} /></button>
      </div>

      <div className="p-2 space-y-2 border-b border-zinc-200 dark:border-zinc-700">
        <div className="relative">
          <IconSearch size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input className={`${champ} w-full pl-7`} placeholder="Rechercher une désignation…"
                 value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className={`${champ} w-full`} value={corpsEtat}
                onChange={e => { setCorpsEtat(e.target.value); setDtu(''); }}>
          <option value="">Tous corps d’état</option>
          {familles.map(({ famille, metiers }) => (
            <optgroup key={famille} label={famille}>
              {metiers.map(m => <option key={m.code} value={m.code}>{m.libelle}</option>)}
            </optgroup>
          ))}
        </select>
        <select className={`${champ} w-full`} value={dtu} onChange={e => setDtu(e.target.value)}>
          <option value="">Tous les NF DTU</option>
          {dtuDisponibles.map(d => <option key={d.code} value={d.code}>{d.code} — {d.titre}</option>)}
        </select>
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
            {q || corpsEtat || dtu
              ? 'Aucun article ne correspond.'
              : "La bibliothèque est vide. Créez des articles depuis la page « Bibliothèque d’ouvrages », ou sélectionnez des lignes ici puis « Envoyer » depuis le ruban."}
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
                  <span className="font-mono text-[#1e5090]">{formatCurrency(Number(a.prix_unitaire) || 0)}</span>
                  {a.dtu_code && <span className="truncate">{a.dtu_code}</span>}
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
          title={canInsert ? undefined : (hintCible ?? 'Sélectionnez d’abord une cible')}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <IconPlus size={13} />
          Insérer {selection.length > 0 && `(${selection.length})`}
        </button>
      </div>
    </div>
  );
};
