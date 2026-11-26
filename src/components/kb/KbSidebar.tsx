// Barre latérale de la « Base de données » (comme celle de Notion) : recherche, favoris, arbre de pages
// repliable, création de pages et de bases, corbeille. L'état replié de l'arbre est mémorisé dans le
// navigateur (confort de lecture, jamais une donnée du cabinet).
import { useEffect, useMemo, useState } from 'react';
import {
  IconChevronRight, IconDatabase, IconFileText, IconPlus, IconRestore, IconSearch, IconStar, IconStarFilled, IconTrash, IconTrashX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { KbPage } from '../../lib/kb';
import { kbApi } from '../../lib/kbApi';
import { buildKbTree, kbBreadcrumb, kbFavorites, kbTrashRoots, type KbTreeNode } from '../../lib/kbTree';
import { cn } from '../../lib/utils';

const EXPANDED_KEY = 'kb:expanded';
const SEARCH_DELAY_MS = 300;

function readExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch { return new Set(); }
}
function writeExpanded(ids: Set<string>): void {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids])); } catch { /* confort seulement */ }
}

interface KbSidebarProps {
  pages: KbPage[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreate: (kind: 'page' | 'database', parentId: string | null) => void;
  onToggleFavorite: (page: KbPage) => void;
  onTrash: (page: KbPage) => void;
  onRestore: (page: KbPage) => void;
  onDeleteForever: (page: KbPage) => void;
  className?: string;
}

function PageIcon({ page }: { page: KbPage }) {
  if (page.icon) return <span aria-hidden className="w-4 text-center shrink-0 leading-none">{page.icon}</span>;
  const Fallback = page.kind === 'database' ? IconDatabase : IconFileText;
  return <Fallback size={16} aria-hidden className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />;
}

export function KbSidebar({ pages, activeId, onOpen, onCreate, onToggleFavorite, onTrash, onRestore, onDeleteForever, className }: KbSidebarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KbPage[] | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const tree = useMemo(() => buildKbTree(pages), [pages]);
  const favorites = useMemo(() => kbFavorites(pages), [pages]);
  const trash = useMemo(() => kbTrashRoots(pages), [pages]);

  // La page ouverte déplie ses ancêtres : on la retrouve toujours dans l'arbre.
  useEffect(() => {
    if (!activeId) return;
    const ancestors = kbBreadcrumb(pages, activeId).slice(0, -1).map(p => p.id);
    if (ancestors.length === 0) return;
    setExpanded(prev => {
      if (ancestors.every(id => prev.has(id))) return prev;
      const next = new Set(prev);
      ancestors.forEach(id => next.add(id));
      writeExpanded(next);
      return next;
    });
  }, [activeId, pages]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      kbApi.search(q).then(list => { if (!cancelled) setResults(list); }).catch(() => { if (!cancelled) setResults([]); });
    }, SEARCH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeExpanded(next);
    return next;
  });

  const actionClass = 'kb-ghost kb-reveal !min-h-0 !p-1';

  const renderNode = (node: KbTreeNode, depth: number): React.ReactNode => {
    const { page } = node;
    const isOpen = expanded.has(page.id);
    const hasChildren = node.children.length > 0;
    const isActive = page.id === activeId;
    const title = page.title || (t('kb_untitled') as string);
    return (
      <li key={page.id}>
        <div
          className={cn('kb-hover-reveal flex items-center gap-1 rounded-lg pr-1 transition-colors', isActive ? 'bg-[var(--kb-wash)]' : 'hover:bg-[var(--kb-wash)]')}
          style={{ paddingLeft: `${depth * 0.875 + 0.25}rem` }}
        >
          <button
            type="button"
            onClick={() => toggle(page.id)}
            aria-label={`${isOpen ? t('kb_collapse') : t('kb_expand')} : ${title}`}
            aria-expanded={hasChildren ? isOpen : undefined}
            tabIndex={hasChildren ? 0 : -1}
            className={cn('p-1 rounded', !hasChildren && 'invisible')}
            style={{ color: 'var(--tblr-muted)' }}
          >
            <IconChevronRight size={14} aria-hidden className={cn('transition-transform', isOpen && 'rotate-90')} />
          </button>
          <button
            type="button"
            onClick={() => onOpen(page.id)}
            aria-current={isActive ? 'page' : undefined}
            className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left text-[0.875rem]"
            style={{ color: 'var(--tblr-text)', fontWeight: isActive ? 600 : 400 }}
          >
            <PageIcon page={page} />
            <span className="truncate">{title}</span>
          </button>
          {page.kind === 'page' && (
            <button type="button" className={actionClass} onClick={() => onCreate('page', page.id)} aria-label={`${t('kb_add_subpage')} : ${title}`} style={{ color: 'var(--tblr-muted)' }}>
              <IconPlus size={14} aria-hidden />
            </button>
          )}
          <button type="button" className={actionClass} onClick={() => onToggleFavorite(page)} aria-label={`${page.is_favorite ? t('kb_favorite_remove') : t('kb_favorite_add')} : ${title}`} aria-pressed={page.is_favorite} style={{ color: 'var(--tblr-muted)' }}>
            {page.is_favorite ? <IconStarFilled size={14} aria-hidden /> : <IconStar size={14} aria-hidden />}
          </button>
          <button type="button" className={actionClass} onClick={() => onTrash(page)} aria-label={`${t('kb_trash_page')} : ${title}`} style={{ color: 'var(--tblr-muted)' }}>
            <IconTrash size={14} aria-hidden />
          </button>
        </div>
        {hasChildren && isOpen && <ul>{node.children.map(child => renderNode(child, depth + 1))}</ul>}
      </li>
    );
  };

  const sectionTitle = 'px-2 pt-4 pb-1 text-[0.75rem] font-medium';

  return (
    <nav aria-label={t('kb_sidebar_label') as string} className={cn('flex flex-col gap-1', className)}>
      <div className="flex gap-1">
        <button type="button" onClick={() => onCreate('page', null)} className="kb-ghost flex-1 justify-start" style={{ color: 'var(--tblr-text)' }}>
          <IconPlus size={16} aria-hidden />{t('kb_new_page')}
        </button>
        <button type="button" onClick={() => onCreate('database', null)} className="kb-ghost" title={t('kb_new_database') as string} aria-label={t('kb_new_database') as string}>
          <IconDatabase size={16} aria-hidden />
        </button>
      </div>

      <label className="relative">
        <span className="sr-only">{t('kb_search_pages')}</span>
        <IconSearch size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('kb_search_pages') as string} className="w-full min-h-8 rounded-lg bg-transparent pl-8 pr-2 text-[0.8125rem] outline-none transition-colors focus:bg-[var(--kb-wash)] placeholder:text-[var(--tblr-muted)]" style={{ color: 'var(--tblr-text)' }} />
      </label>

      {results !== null ? (
        <ul aria-label={t('kb_search_pages') as string}>
          {results.length === 0 && <li className="px-2 py-1.5 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_search_none')}</li>}
          {results.map(page => (
            <li key={page.id}>
              <button type="button" onClick={() => { setQuery(''); onOpen(page.id); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-text)' }}>
                <PageIcon page={page} /><span className="truncate">{page.title || t('kb_untitled')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {favorites.length > 0 && (
            <section aria-label={t('kb_favorites') as string}>
              <h3 className={sectionTitle} style={{ color: 'var(--tblr-muted)' }}>{t('kb_favorites')}</h3>
              <ul>
                {favorites.map(page => (
                  <li key={page.id}>
                    <button type="button" onClick={() => onOpen(page.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-text)' }}>
                      <PageIcon page={page} /><span className="truncate">{page.title || t('kb_untitled')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-label={t('kb_pages') as string}>
            <h3 className={sectionTitle} style={{ color: 'var(--tblr-muted)' }}>{t('kb_pages')}</h3>
            {tree.length === 0
              ? <p className="px-2 py-1.5 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_tree_empty')}</p>
              : <ul>{tree.map(node => renderNode(node, 0))}</ul>}
          </section>
        </>
      )}

      <section aria-label={t('kb_trash') as string}>
        <button type="button" onClick={() => setTrashOpen(v => !v)} aria-expanded={trashOpen} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-muted)' }}>
          <IconTrash size={16} aria-hidden />{t('kb_trash')}
          {trash.length > 0 && <span className="tblr-badge ml-auto">{trash.length}</span>}
        </button>
        {trashOpen && (
          <ul>
            {trash.length === 0 && <li className="px-2 py-1.5 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_trash_empty')}</li>}
            {trash.map(page => (
              <li key={page.id} className="kb-hover-reveal flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--kb-wash)]">
                <PageIcon page={page} />
                <span className="flex-1 min-w-0 truncate text-[0.875rem]" style={{ color: 'var(--tblr-text)' }}>{page.title || t('kb_untitled')}</span>
                <button type="button" onClick={() => onRestore(page)} aria-label={`${t('kb_restore')} : ${page.title || t('kb_untitled')}`} className="p-1 rounded hover:bg-[var(--tblr-surface)]" style={{ color: 'var(--tblr-muted)' }}>
                  <IconRestore size={14} aria-hidden />
                </button>
                <button type="button" onClick={() => onDeleteForever(page)} aria-label={`${t('kb_delete_forever')} : ${page.title || t('kb_untitled')}`} className="p-1 rounded hover:bg-[var(--tblr-surface)]" style={{ color: 'var(--tblr-danger)' }}>
                  <IconTrashX size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </nav>
  );
}
