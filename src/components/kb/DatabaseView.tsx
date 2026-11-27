// Vue tableau d'une base de données du cabinet (le tableau « Fabricants » de Notion) : colonnes typées,
// étiquettes colorées, recherche, filtres, tris, colonnes masquables, ajout de ligne et de colonne.
// Les modifications s'appliquent tout de suite puis partent au serveur ; un échec recharge les lignes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  IconArrowUpRight, IconCalendar, IconCheckbox, IconDots, IconHash, IconLink, IconList, IconPlus, IconSearch,
  IconTags, IconTrash, IconTypography, IconLayoutList, IconUpload,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import {
  KB_PROPERTY_TYPES, applyKbView, type KbOption, type KbPage, type KbProperty, type KbPropertyType, type KbViewConfig,
} from '../../lib/kb';
import { kbApi, type KbView } from '../../lib/kbApi';
import { useToastWithUndo } from '../../hooks/useToastWithUndo';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { Toast } from '../ui/Toast';
import { ErrorState, ListSkeleton } from '../DataState';
import { KbCell } from './KbCell';
import { KbImportDialog } from './KbImportDialog';
import { KbPopover } from './KbPopover';
import { KbViewControls } from './KbViewControls';

const TYPE_ICONS: Record<KbPropertyType, Icon> = {
  title: IconTypography, text: IconLayoutList, number: IconHash, select: IconList, multi_select: IconTags,
  date: IconCalendar, checkbox: IconCheckbox, url: IconLink, relation: IconLink,
};
/** Types proposés à la création d'une colonne (les relations entre bases viendront plus tard). */
const CREATABLE_TYPES = KB_PROPERTY_TYPES.filter(type => type !== 'title' && type !== 'relation') as Array<Exclude<KbPropertyType, 'title' | 'relation'>>;

const SAVE_VIEW_DELAY_MS = 600;

interface DatabaseViewProps {
  database: KbPage;
  /** Ouvre une ligne comme une page. */
  onOpenRow: (id: string) => void;
}

function PropertyHeader({ property, onRename, onDelete, onHide }: {
  property: KbProperty; onRename: (name: string) => void; onDelete: () => void; onHide: () => void;
}) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(property.name);
  useEffect(() => setName(property.name), [property.name]);
  const TypeIcon = TYPE_ICONS[property.type];
  const isTitle = property.type === 'title';

  const submit = () => {
    const next = name.trim();
    if (next && next !== property.name) onRename(next);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <TypeIcon size={14} aria-hidden style={{ color: 'var(--tblr-muted)' }} />
      <span className="truncate">{property.name}</span>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t('kb_column_menu')} : ${property.name}`}
        aria-haspopup="dialog"
        className="kb-ghost kb-reveal ml-auto !min-h-0 !p-1"
      >
        <IconDots size={14} aria-hidden />
      </button>
      <KbPopover anchorRef={anchor} open={open} onClose={submit} label={t('kb_column_menu') as string} width={240}>
        <div className="p-2 space-y-2 normal-case tracking-normal font-normal">
          <input
            autoFocus
            aria-label={t('kb_column_name') as string}
            className="tblr-input w-full"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
          {!isTitle && (
            <>
              <button type="button" onClick={() => { setOpen(false); onHide(); }} className="w-full text-left px-2 py-1.5 rounded text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-text)' }}>{t('kb_column_hide')}</button>
              <button type="button" onClick={() => { setOpen(false); onDelete(); }} className="w-full text-left px-2 py-1.5 rounded text-[0.875rem] hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-danger)' }}>{t('kb_column_delete')}</button>
            </>
          )}
        </div>
      </KbPopover>
    </div>
  );
}

function AddPropertyButton({ onAdd }: { onAdd: (name: string, type: Exclude<KbPropertyType, 'title'>) => Promise<void> }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<Exclude<KbPropertyType, 'title'>>('text');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try { await onAdd(trimmed, type); setName(''); setType('text'); setOpen(false); }
    catch { /* le tableau a déjà prévenu */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} aria-label={t('kb_column_add') as string} aria-haspopup="dialog" className="kb-ghost !min-h-0 !p-1">
        <IconPlus size={16} aria-hidden />
      </button>
      <KbPopover anchorRef={anchor} open={open} onClose={() => setOpen(false)} label={t('kb_column_add') as string} width={260}>
        <form className="p-2 space-y-2 normal-case tracking-normal font-normal" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <input autoFocus aria-label={t('kb_column_name') as string} placeholder={t('kb_column_name') as string} className="tblr-input w-full" value={name} onChange={e => setName(e.target.value)} />
          <select aria-label={t('kb_column_type') as string} className="tblr-input w-full" value={type} onChange={e => setType(e.target.value as typeof type)}>
            {CREATABLE_TYPES.map(item => <option key={item} value={item}>{t(`kb_type_${item}`)}</option>)}
          </select>
          <button type="submit" disabled={!name.trim() || busy} className="btn btn-primary w-full">{t('kb_column_create')}</button>
        </form>
      </KbPopover>
    </>
  );
}

export function DatabaseView({ database, onOpenRow }: DatabaseViewProps) {
  const { t } = useTranslation();
  const { toast, showToast } = useToastWithUndo();
  const { confirm, dialog } = useConfirmDialog();
  const [properties, setProperties] = useState<KbProperty[]>([]);
  const [rows, setRows] = useState<KbPage[]>([]);
  const [view, setView] = useState<KbView | null>(null);
  const [config, setConfig] = useState<KbViewConfig>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [freshRowId, setFreshRowId] = useState<string | null>(null);
  const saveTimer =useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [props, rowList, views] = await Promise.all([kbApi.properties(database.id), kbApi.rows(database.id), kbApi.views(database.id)]);
      setProperties(props);
      setRows(rowList);
      setView(views[0] ?? null);
      setConfig(views[0]?.config ?? {});
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [database.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const reloadRows = async () => {
    try { setRows(await kbApi.rows(database.id)); } catch { /* l'écran garde ses lignes */ }
  };

  const updateConfig = (next: KbViewConfig) => {
    setConfig(next);
    if (!view) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void kbApi.updateView(database.id, view.id, { config: next }).catch(() => {}); }, SAVE_VIEW_DELAY_MS);
  };

  const hidden = config.hidden || [];
  const visibleProperties = useMemo(() => properties.filter(p => p.type === 'title' || !hidden.includes(p.id)), [properties, hidden]);
  const shownRows = useMemo(() => applyKbView(rows, properties, config, search), [rows, properties, config, search]);
  const titleProperty = properties.find(p => p.type === 'title');
  const filtersActive = (config.filters?.length ?? 0) > 0 || search.trim() !== '';
  const errorText = (e: any) => e?.message || (t('kb_error_generic') as string);

  const addRow = async () => {
    try {
      const created = await kbApi.createPage({ parent_id: database.id, title: '' });
      setFreshRowId(created.id);
      setRows(prev => [...prev, { ...created, properties: created.properties ?? {} }]);
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const commitCell = async (row: KbPage, property: KbProperty, value: unknown) => {
    const isTitle = property.type === 'title';
    setRows(prev => prev.map(r => (r.id !== row.id ? r : isTitle
      ? { ...r, title: String(value ?? '') }
      : { ...r, properties: { ...(r.properties || {}), [property.id]: value } })));
    try {
      await kbApi.updatePage(row.id, isTitle ? { title: String(value ?? '') } : { properties: { [property.id]: value } });
    } catch (e: any) {
      showToast(errorText(e), 'error');
      await reloadRows();
    }
  };

  const changeOptions = async (property: KbProperty, options: KbOption[]): Promise<KbOption[]> => {
    try {
      const saved = await kbApi.updateProperty(database.id, property.id, { options });
      setProperties(prev => prev.map(p => (p.id === property.id ? saved : p)));
      return saved.options;
    } catch (e: any) {
      showToast(errorText(e), 'error');
      return property.options;
    }
  };

  const addProperty = async (name: string, type: Exclude<KbPropertyType, 'title'>) => {
    try {
      const created = await kbApi.createProperty(database.id, { name, type });
      setProperties(prev => [...prev, created]);
    } catch (e: any) {
      showToast(errorText(e), 'error');
      throw e;
    }
  };

  const renameProperty = async (property: KbProperty, name: string) => {
    try {
      const saved = await kbApi.updateProperty(database.id, property.id, { name });
      setProperties(prev => prev.map(p => (p.id === property.id ? saved : p)));
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const deleteProperty = async (property: KbProperty) => {
    const ok = await confirm({
      title: t('kb_column_delete_title', { name: property.name }) as string,
      message: t('kb_column_delete_message') as string,
      confirmLabel: t('kb_column_delete') as string,
      cancelLabel: t('kb_cancel') as string,
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await kbApi.deleteProperty(database.id, property.id);
      setProperties(prev => prev.filter(p => p.id !== property.id));
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const trashRow = async (row: KbPage) => {
    setRows(prev => prev.filter(r => r.id !== row.id));
    try {
      await kbApi.trashPage(row.id);
      showToast(t('kb_row_trashed') as string, 'success', {
        duration: 6000,
        action: { label: t('kb_undo') as string, onClick: () => { void kbApi.restorePage(row.id).then(reloadRows); } },
      });
    } catch (e: any) {
      showToast(errorText(e), 'error');
      await reloadRows();
    }
  };

  if (loading) return <ListSkeleton rows={4} />;
  if (failed) return <ErrorState onRetry={() => void load()} />;

  const toolsActive = filtersActive || (config.sorts?.length ?? 0) > 0 || hidden.length > 0;

  return (
    <div className="kb-db">
      <h2 className="sr-only">{database.title || t('kb_untitled')}</h2>
      <div className="flex flex-wrap items-center gap-1 mb-1 min-h-8">
        <p className="mr-auto px-1 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_row_count', { count: shownRows.length })}</p>
        <div className="kb-tools flex flex-wrap items-center gap-0.5" data-active={toolsActive}>
          <KbViewControls properties={properties} config={config} onChange={updateConfig} />
          <label className="kb-search">
            <span className="sr-only">{t('kb_search_rows')}</span>
            <IconSearch size={14} aria-hidden />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('kb_search_rows') as string} />
          </label>
          <button type="button" onClick={() => setImportOpen(true)} className="kb-ghost" aria-label={t('kb_import') as string} title={t('kb_import') as string} aria-haspopup="dialog">
            <IconUpload size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="kb-table" style={{ minWidth: `${Math.max(1, visibleProperties.length) * 11}rem` }}>
          <thead>
            <tr>
              {visibleProperties.map(property => (
                <th key={property.id} scope="col" className="kb-hover-reveal" style={{ width: property.width ? `${property.width}px` : undefined }}>
                  <PropertyHeader
                    property={property}
                    onRename={name => void renameProperty(property, name)}
                    onDelete={() => void deleteProperty(property)}
                    onHide={() => updateConfig({ ...config, hidden: [...hidden, property.id] })}
                  />
                </th>
              ))}
              <th scope="col" className="w-20"><div className="flex items-center justify-end"><AddPropertyButton onAdd={addProperty} /></div></th>
            </tr>
          </thead>
          <tbody>
            {shownRows.length === 0 && (
              <tr>
                <td colSpan={visibleProperties.length + 1} className="table-empty-message" style={{ color: 'var(--tblr-muted)' }}>
                  {filtersActive ? t('kb_no_match') : t('kb_no_rows')}
                </td>
              </tr>
            )}
            {shownRows.map(row => (
              // Seule une ligne qu'on vient d'ajouter apparaît en fondu : pas de cascade à l'ouverture de la base.
              <motion.tr
                key={row.id}
                className="kb-hover-reveal"
                initial={row.id === freshRowId ? { opacity: 0, y: -8 } : false}
                animate={{ opacity: 1, y: 0 }}
              >
                {visibleProperties.map(property => (
                  <td key={property.id}>
                    <div className="flex items-start gap-1">
                      <div className="flex-1 min-w-0">
                        <KbCell
                          property={property}
                          value={property.type === 'title' ? row.title : row.properties?.[property.id]}
                          onCommit={value => void commitCell(row, property, value)}
                          onOptionsChange={options => changeOptions(property, options)}
                        />
                      </div>
                      {property.id === titleProperty?.id && (
                        <button
                          type="button"
                          onClick={() => onOpenRow(row.id)}
                          aria-label={`${t('kb_open_row')} : ${row.title || t('kb_untitled')}`}
                          className="kb-ghost kb-reveal !min-h-0 !p-1"
                        >
                          <IconArrowUpRight size={14} aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                ))}
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => void trashRow(row)}
                    aria-label={`${t('kb_row_trash')} : ${row.title || t('kb_untitled')}`}
                    className="kb-ghost kb-reveal !min-h-0 !p-1"
                  >
                    <IconTrash size={14} aria-hidden />
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => void addRow()} className="kb-ghost mt-1 w-full justify-start">
        <IconPlus size={16} aria-hidden />{t('kb_new')}
      </button>

      {dialog}
      <Toast toast={toast} />
      <AnimatePresence>
        {importOpen && (
          <KbImportDialog
            key="import"
            database={database}
            onClose={() => setImportOpen(false)}
            onDone={() => { setImportOpen(false); void load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
