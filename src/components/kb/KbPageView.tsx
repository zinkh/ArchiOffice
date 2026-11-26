// Une page de la « Base de données » : fil d'Ariane, icône, titre, état d'enregistrement, puis l'éditeur de
// blocs (page libre ou ligne de base) ou le tableau (base de données). Une ligne de base montre aussi ses
// propriétés en tête de page, comme Notion. Tout s'enregistre seul (useKbAutosave).
import { useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { IconChevronRight, IconStar, IconStarFilled, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { KbOption, KbPage, KbProperty } from '../../lib/kb';
import { kbApi } from '../../lib/kbApi';
import { kbBreadcrumb } from '../../lib/kbTree';
import { useKbAutosave } from '../../hooks/useKbAutosave';
import { AutosaveIndicator } from '../projectDetail/AutosaveIndicator';
import { BlockEditor } from './BlockEditor';
import { DatabaseView } from './DatabaseView';
import { KbCell } from './KbCell';
import { KbPopover } from './KbPopover';

const EMOJIS = ['📄', '📁', '🏗️', '🧱', '🪟', '🚪', '🔧', '📐', '📏', '🏠', '🌿', '💡', '🔥', '💧', '🧰', '📌', '⭐', '✅', '⚠️', '📞', '📧', '🧾', '🗂️', '🧪'];

type LocalPatch = Partial<Pick<KbPage, 'title' | 'icon' | 'is_favorite'>>;

interface KbPageViewProps {
  /** Page complète (contenu et valeurs comprises). */
  page: KbPage;
  /** Liste légère de toutes les pages, pour le fil d'Ariane et la base parente d'une ligne. */
  pages: KbPage[];
  onOpen: (id: string) => void;
  onLocalChange: (patch: LocalPatch) => void;
  onTrash: (page: KbPage) => void;
}

function RowProperties({ page, database }: { page: KbPage; database: KbPage }) {
  const { t } = useTranslation();
  const [properties, setProperties] = useState<KbProperty[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>(page.properties || {});
  const { status, schedule, saveNow } = useKbAutosave(page.id);

  useEffect(() => {
    let cancelled = false;
    kbApi.properties(database.id).then(list => { if (!cancelled) setProperties(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [database.id]);

  const commit = (property: KbProperty, value: unknown) => {
    setValues(prev => ({ ...prev, [property.id]: value }));
    schedule({ properties: { [property.id]: value } });
  };
  const changeOptions = async (property: KbProperty, options: KbOption[]): Promise<KbOption[]> => {
    const saved = await kbApi.updateProperty(database.id, property.id, { options });
    setProperties(prev => prev.map(p => (p.id === property.id ? saved : p)));
    return saved.options;
  };

  const editable = properties.filter(p => p.type !== 'title');
  if (editable.length === 0) return null;
  return (
    <section aria-label={t('kb_row_properties') as string} className="mb-4 grid grid-cols-[minmax(7rem,10rem)_1fr] gap-x-3 gap-y-1 items-start">
      {editable.map(property => (
        <div key={property.id} className="contents">
          <div className="py-1 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{property.name}</div>
          <div><KbCell property={property} value={values[property.id]} onCommit={value => commit(property, value)} onOptionsChange={options => changeOptions(property, options)} /></div>
        </div>
      ))}
      <div className="col-span-2 flex justify-end"><AutosaveIndicator status={status} onRetry={() => void saveNow()} /></div>
    </section>
  );
}

export function KbPageView({ page, pages, onOpen, onLocalChange, onTrash }: KbPageViewProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(page.title);
  const [iconOpen, setIconOpen] = useState(false);
  const iconAnchor = useRef<HTMLButtonElement>(null);
  const { status, schedule, saveNow } = useKbAutosave(page.id);

  const crumbs = kbBreadcrumb(pages, page.id);
  const parent = page.parent_id ? pages.find(p => p.id === page.parent_id) : undefined;
  const isRow = parent?.kind === 'database';
  const isDatabase = page.kind === 'database';
  const listed = pages.find(p => p.id === page.id) ?? page;

  const changeTitle = (value: string) => {
    setTitle(value);
    onLocalChange({ title: value });
    schedule({ title: value });
  };
  const chooseIcon = (icon: string | null) => {
    onLocalChange({ icon });
    schedule({ icon });
    setIconOpen(false);
  };

  return (
    <article aria-label={title || (t('kb_untitled') as string)}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <nav aria-label={t('kb_breadcrumb') as string} className="flex flex-wrap items-center gap-1 min-w-0 mr-auto text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>
          {crumbs.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1 min-w-0">
              {index > 0 && <IconChevronRight size={12} aria-hidden />}
              {index < crumbs.length - 1
                ? <button type="button" onClick={() => onOpen(crumb.id)} className="truncate max-w-[10rem] hover:underline">{crumb.title || t('kb_untitled')}</button>
                : <span className="truncate max-w-[14rem]" aria-current="page">{title || t('kb_untitled')}</span>}
            </span>
          ))}
        </nav>
        <AutosaveIndicator status={status} onRetry={() => void saveNow()} />
        <button
          type="button"
          onClick={() => { onLocalChange({ is_favorite: !listed.is_favorite }); schedule({ is_favorite: !listed.is_favorite }); }}
          aria-pressed={listed.is_favorite}
          aria-label={(listed.is_favorite ? t('kb_favorite_remove') : t('kb_favorite_add')) as string}
          className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]"
          style={{ color: 'var(--tblr-muted)' }}
        >
          {listed.is_favorite ? <IconStarFilled size={16} aria-hidden /> : <IconStar size={16} aria-hidden />}
        </button>
        <button type="button" onClick={() => onTrash(page)} aria-label={t('kb_trash_page') as string} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-muted)' }}>
          <IconTrash size={16} aria-hidden />
        </button>
      </div>

      <div className="flex items-start gap-2 mb-4">
        <button
          ref={iconAnchor}
          type="button"
          onClick={() => setIconOpen(true)}
          aria-label={t('kb_icon_choose') as string}
          aria-haspopup="dialog"
          className="shrink-0 w-10 h-10 flex items-center justify-center rounded text-[1.5rem] hover:bg-[var(--tblr-surface-2)]"
        >
          {listed.icon || <span aria-hidden style={{ color: 'var(--tblr-muted)' }}>＋</span>}
        </button>
        <KbPopover anchorRef={iconAnchor} open={iconOpen} onClose={() => setIconOpen(false)} label={t('kb_icon_choose') as string} width={248}>
          <div className="p-2">
            <div className="grid grid-cols-6 gap-1">
              {EMOJIS.map(emoji => (
                <button key={emoji} type="button" onClick={() => chooseIcon(emoji)} aria-label={emoji} className="w-9 h-9 rounded text-[1.25rem] hover:bg-[var(--tblr-surface-2)]">{emoji}</button>
              ))}
            </div>
            {listed.icon && <button type="button" onClick={() => chooseIcon(null)} className="btn btn-ghost w-full mt-2">{t('kb_icon_remove')}</button>}
          </div>
        </KbPopover>
        <input
          value={title}
          onChange={e => changeTitle(e.target.value)}
          placeholder={t('kb_untitled') as string}
          aria-label={t('kb_page_title') as string}
          maxLength={200}
          className="flex-1 min-w-0 bg-transparent outline-none text-[1.875rem] font-bold leading-tight px-1"
          style={{ color: 'var(--tblr-text)' }}
        />
      </div>

      {isDatabase
        ? <DatabaseView key={page.id} database={{ ...page, title }} onOpenRow={onOpen} />
        : (
          <>
            {isRow && parent && <RowProperties key={`props-${page.id}`} page={page} database={parent} />}
            <BlockEditor
              key={`editor-${page.id}`}
              pageId={page.id}
              value={page.content ?? null}
              onChange={(json: JSONContent) => schedule({ content: json })}
            />
          </>
        )}
    </article>
  );
}
