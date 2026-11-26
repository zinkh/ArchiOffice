import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArticleBibliotheque } from '../../types/library';
import { formatCurrency } from '../../lib/utils';

/**
 * Liste des ouvrages proposés pendant la saisie d'un titre : désignation, puis unité et prix en discret.
 * `mousedown` plutôt que `click` : le champ perdrait le focus (et validerait) avant le choix.
 */
export function ListeArticlesBibliotheque({ articles, actif, onChoisir, style, className = '' }: {
  articles: ArticleBibliotheque[]; actif: number; onChoisir: (a: ArticleBibliotheque) => void; style?: CSSProperties; className?: string;
}) {
  const { t } = useTranslation();
  if (!articles.length) return null;
  return (
    <ul
      role="listbox"
      aria-label={t('pro_library_suggest_label')}
      className={`z-50 max-h-56 overflow-auto rounded border shadow-lg text-xs py-1 ${className}`}
      style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', ...style }}
    >
      {articles.map((a, i) => (
        <li
          key={a.id}
          role="option"
          aria-selected={i === actif}
          onMouseDown={e => { e.preventDefault(); onChoisir(a); }}
          className="px-2 py-1 cursor-pointer hover:bg-[var(--tblr-surface-2)] flex items-baseline justify-between gap-3"
          style={i === actif ? { background: 'var(--tblr-primary-lt)' } : undefined}
        >
          <span className="truncate">{a.designation}</span>
          <span className="shrink-0 font-mono tabular-nums" style={{ color: 'var(--tblr-muted)' }}>
            {[a.unite?.trim(), Number(a.prix_unitaire) > 0 ? formatCurrency(Number(a.prix_unitaire)) : ''].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
