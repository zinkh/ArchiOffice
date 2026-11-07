// Saisie des postes associés d'un article de la bibliothèque (fiche de la page Bibliothèque d'ouvrages).
// Appelé par `pages/Specifications.tsx`. Les associés sont proposés à l'insertion (`PriceLibraryPanel`).
import React, { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { MAX_ASSOCIES, type PosteAssocie } from '../../lib/postesAssocies';
import type { ArticleBibliotheque } from '../../types/library';

interface Props {
  /** L'article édité : il ne peut pas être son propre associé. */
  articleId?: string;
  value: PosteAssocie[];
  onChange: (valeur: PosteAssocie[]) => void;
}

export const PostesAssociesEditor: React.FC<Props> = ({ articleId, value, onChange }) => {
  const [noms, setNoms] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState<ArticleBibliotheque[]>([]);

  const cle = value.map(v => v.articleId).join(',');
  useEffect(() => {
    if (!cle) return;
    let actif = true;
    apiFetch<ArticleBibliotheque[]>(`/api/price-library?ids=${cle}&limit=200`)
      .then(l => { if (actif) setNoms(Object.fromEntries(l.map(a => [a.id, a.designation]))); })
      .catch(() => {});
    return () => { actif = false; };
  }, [cle]);

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return; }
    let actif = true;
    const t = setTimeout(() => {
      apiFetch<ArticleBibliotheque[]>(`/api/price-library?dossier=ouvrages&limit=8&q=${encodeURIComponent(q.trim())}`)
        .then(l => { if (actif) setResultats(l.filter(a => a.id !== articleId && !value.some(v => v.articleId === a.id))); })
        .catch(() => {});
    }, 250);
    return () => { actif = false; clearTimeout(t); };
  }, [q, articleId, value]);

  const ajouter = (a: ArticleBibliotheque) => {
    setNoms(n => ({ ...n, [a.id]: a.designation }));
    onChange([...value, { articleId: a.id }]);
    setQ('');
  };

  return (
    <div className="text-sm">
      <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>Postes associés</span>
      <p className="mb-2 text-xs text-zinc-500">Proposés avec cet article quand on l’insère dans un CCTP, un DPGF ou un DQE (ex. volet roulant pour une fenêtre).</p>
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {value.map(v => (
          <li key={v.articleId} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs">
            {noms[v.articleId] ?? 'Article supprimé'}
            <button type="button" aria-label={`Retirer ${noms[v.articleId] ?? 'cet associé'}`}
                    onClick={() => onChange(value.filter(x => x.articleId !== v.articleId))}
                    className="text-zinc-400 hover:text-zinc-700"><IconX size={12} /></button>
          </li>
        ))}
      </ul>
      {value.length < MAX_ASSOCIES && (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un article à associer…"
                 className="w-full px-3 py-2 rounded-lg text-sm outline-none border border-zinc-300" />
          {resultats.length > 0 && (
            <ul role="listbox" className="mt-1 max-h-40 overflow-y-auto rounded border border-zinc-200 bg-white">
              {resultats.map(a => (
                <li key={a.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => ajouter(a)}
                          className="w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50">{a.designation}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
