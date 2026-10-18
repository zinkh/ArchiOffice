import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useGlobalSearch } from '../hooks/useGlobalSearch';

export function GlobalSearch({ scopeKey }: { scopeKey: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const { results, status, isSearching, retry, query: normalizedQuery } = useGlobalSearch(query, scopeKey);
  const hasQuery = normalizedQuery.length >= 2;
  const empty = Object.values(results).every(items => items.length === 0);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setQuery(''); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(true); inputRef.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outside); };
  }, []);

  return (
    <div ref={containerRef} className="relative hidden md:flex">
      <div className="relative">
        <IconSearch size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
        <input id="global-search-input" ref={inputRef} type="search" value={query}
          onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          aria-label={t('search_placeholder')} aria-controls={open && hasQuery ? panelId : undefined}
          placeholder={`${t('search_placeholder')} (Ctrl+K)`}
          style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', borderRadius: 'var(--tblr-radius)', fontSize: '0.8125rem' }}
          className="pl-8 pr-7 py-1.5 w-52 outline-none transition-[border-color,box-shadow] focus:w-72 focus:border-[var(--tblr-primary)] focus:shadow-[0_0_0_3px_var(--tblr-primary-lt)]" />
        {isSearching && <span aria-hidden className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--tblr-primary) transparent transparent transparent' }} />}
      </div>
      {open && hasQuery && (
        <div id={panelId} role="region" aria-label={t('global_search_results')} aria-busy={isSearching}
          className="absolute top-full mt-1 left-0 w-96 z-50 overflow-hidden max-h-[70dvh] overflow-y-auto"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', borderRadius: 'var(--tblr-radius)', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          {status === 'loading' ? (
            <p role="status" className="p-4 text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('global_search_loading')}</p>
          ) : status === 'error' ? (
            <div role="alert" className="p-4 space-y-3 text-sm" style={{ color: 'var(--tblr-text)' }}>
              <p>{t('global_search_failed')}</p>
              <button type="button" onClick={() => { retry(); inputRef.current?.focus(); }} className="btn btn-secondary min-h-11 focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]">{t('retry_btn')}</button>
            </div>
          ) : status === 'success' && empty ? (
            <p role="status" className="p-4 text-sm text-center" style={{ color: 'var(--tblr-muted)' }}>{t('global_search_empty', { query: normalizedQuery })}</p>
          ) : status === 'success' ? (
            <div>
              {([
                { key: 'projects', label: t('global_search_projects'), path: (id: string) => `/projects/${id}`, color: '#206bc4', letter: 'P' },
                { key: 'contacts', label: t('global_search_contacts'), path: () => '/contacts', color: '#2fb344', letter: 'C' },
                { key: 'tenders', label: t('global_search_tenders'), path: (id: string) => `/tenders/${id}`, color: '#f76707', letter: 'A' },
                { key: 'invoices', label: t('global_search_invoices'), path: () => '/invoices', color: '#ae3ec9', letter: 'F' },
              ] as const).map(({ key, label, path, color, letter }) => !results[key].length ? null : (
                <div key={key}>
                  <div className="px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider border-b" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', borderColor: 'var(--tblr-border)' }}>{label}</div>
                  {results[key].map(item => (
                    <Link key={item.id} to={path(item.id)} onClick={() => { setOpen(false); setQuery(''); }}
                      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--tblr-surface-2)] focus-visible:bg-[var(--tblr-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--tblr-primary)]"
                      style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                      <span aria-hidden className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: color }}>{letter}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.8125rem] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{item._label}</p>
                        {(item.client || item.email) && <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{item.client || item.email}</p>}
                      </div>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
