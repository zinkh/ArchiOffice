// Barre de contrôle d'une vue de la « Base de données » : filtres, tris et colonnes visibles. Chaque bouton
// ouvre une fenêtre ; le changement est rendu au tableau (`onChange`), qui l'applique tout de suite et
// l'enregistre dans la vue (kb_views.config).
import { useRef, useState } from 'react';
import { IconArrowsSort, IconColumns3, IconFilter, IconPlus, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { kbFilterOps, kbOpNeedsValue, type KbFilter, type KbProperty, type KbSort, type KbViewConfig } from '../../lib/kb';
import { KbPopover } from './KbPopover';

interface KbViewControlsProps {
  properties: KbProperty[];
  config: KbViewConfig;
  onChange: (next: KbViewConfig) => void;
}

function ControlButton({ anchorRef, label, count, icon, onClick }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>; label: string; count: number; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button ref={anchorRef} type="button" onClick={onClick} className="kb-ghost" aria-haspopup="dialog" aria-label={label} title={label}>
      {icon}
      {count > 0 && <span className="text-[0.75rem] font-semibold" style={{ color: 'var(--tblr-primary)' }}>{count}</span>}
    </button>
  );
}

export function KbViewControls({ properties, config, onChange }: KbViewControlsProps) {
  const { t } = useTranslation();
  const filterRef = useRef<HTMLButtonElement>(null);
  const sortRef = useRef<HTMLButtonElement>(null);
  const columnsRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<'filter' | 'sort' | 'columns' | null>(null);
  const close = () => setOpen(null);

  const filters = config.filters || [];
  const sorts = config.sorts || [];
  const hidden = config.hidden || [];
  const byId = (id: string) => properties.find(p => p.id === id);

  const setFilter = (index: number, patch: Partial<KbFilter>) =>
    onChange({ ...config, filters: filters.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  const changeFilterProperty = (index: number, propertyId: string) => {
    const property = byId(propertyId);
    if (!property) return;
    setFilter(index, { property_id: propertyId, op: kbFilterOps(property.type)[0], value: '' });
  };
  const addFilter = () => {
    const first = properties[0];
    if (!first) return;
    onChange({ ...config, filters: [...filters, { property_id: first.id, op: kbFilterOps(first.type)[0], value: '' }] });
  };
  const removeFilter = (index: number) => onChange({ ...config, filters: filters.filter((_, i) => i !== index) });

  const setSort = (index: number, patch: Partial<KbSort>) =>
    onChange({ ...config, sorts: sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const addSort = () => {
    const used = new Set(sorts.map(s => s.property_id));
    const next = properties.find(p => !used.has(p.id)) ?? properties[0];
    if (next) onChange({ ...config, sorts: [...sorts, { property_id: next.id, direction: 'asc' }] });
  };
  const removeSort = (index: number) => onChange({ ...config, sorts: sorts.filter((_, i) => i !== index) });

  const toggleColumn = (id: string) =>
    onChange({ ...config, hidden: hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id] });

  const selectClass = 'tblr-input';

  return (
    <>
      <ControlButton anchorRef={filterRef} label={t('kb_filter') as string} count={filters.length} icon={<IconFilter size={16} aria-hidden />} onClick={() => setOpen('filter')} />
      <ControlButton anchorRef={sortRef} label={t('kb_sort') as string} count={sorts.length} icon={<IconArrowsSort size={16} aria-hidden />} onClick={() => setOpen('sort')} />
      <ControlButton anchorRef={columnsRef} label={t('kb_columns') as string} count={hidden.length} icon={<IconColumns3 size={16} aria-hidden />} onClick={() => setOpen('columns')} />

      <KbPopover anchorRef={filterRef} open={open === 'filter'} onClose={close} label={t('kb_filter') as string} width={420}>
        <div className="p-2 space-y-2">
          {filters.length === 0 && <p className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_filter_none')}</p>}
          {filters.map((filter, index) => {
            const property = byId(filter.property_id);
            const ops = property ? kbFilterOps(property.type) : [];
            return (
              <div key={index} className="flex flex-wrap items-center gap-1.5">
                <select aria-label={t('kb_filter_property') as string} className={selectClass} value={filter.property_id} onChange={e => changeFilterProperty(index, e.target.value)}>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select aria-label={t('kb_filter_op') as string} className={selectClass} value={filter.op} onChange={e => setFilter(index, { op: e.target.value as KbFilter['op'], value: '' })}>
                  {ops.map(op => <option key={op} value={op}>{t(`kb_op_${op}`)}</option>)}
                </select>
                {kbOpNeedsValue(filter.op) && (property?.type === 'select' || property?.type === 'multi_select' ? (
                  <select aria-label={t('kb_filter_value') as string} className={selectClass} value={filter.value || ''} onChange={e => setFilter(index, { value: e.target.value })}>
                    <option value="">{t('kb_filter_choose')}</option>
                    {property.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                ) : (
                  <input aria-label={t('kb_filter_value') as string} className={`${selectClass} min-w-0 flex-1`} value={filter.value || ''} onChange={e => setFilter(index, { value: e.target.value })} />
                ))}
                <button type="button" aria-label={t('kb_filter_remove') as string} onClick={() => removeFilter(index)} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-muted)' }}>
                  <IconX size={14} aria-hidden />
                </button>
              </div>
            );
          })}
          <button type="button" onClick={addFilter} className="btn btn-ghost inline-flex items-center gap-1.5"><IconPlus size={14} aria-hidden />{t('kb_filter_add')}</button>
        </div>
      </KbPopover>

      <KbPopover anchorRef={sortRef} open={open === 'sort'} onClose={close} label={t('kb_sort') as string} width={340}>
        <div className="p-2 space-y-2">
          {sorts.length === 0 && <p className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_sort_none')}</p>}
          {sorts.map((sort, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <select aria-label={t('kb_filter_property') as string} className={`${selectClass} flex-1 min-w-0`} value={sort.property_id} onChange={e => setSort(index, { property_id: e.target.value })}>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select aria-label={t('kb_sort_direction') as string} className={selectClass} value={sort.direction} onChange={e => setSort(index, { direction: e.target.value as KbSort['direction'] })}>
                <option value="asc">{t('kb_sort_asc')}</option>
                <option value="desc">{t('kb_sort_desc')}</option>
              </select>
              <button type="button" aria-label={t('kb_sort_remove') as string} onClick={() => removeSort(index)} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-muted)' }}>
                <IconX size={14} aria-hidden />
              </button>
            </div>
          ))}
          <button type="button" onClick={addSort} className="btn btn-ghost inline-flex items-center gap-1.5"><IconPlus size={14} aria-hidden />{t('kb_sort_add')}</button>
        </div>
      </KbPopover>

      <KbPopover anchorRef={columnsRef} open={open === 'columns'} onClose={close} label={t('kb_columns') as string} width={260}>
        <ul className="p-1">
          {properties.map(p => (
            <li key={p.id}>
              <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--tblr-surface-2)] cursor-pointer">
                <input type="checkbox" checked={p.type === 'title' || !hidden.includes(p.id)} disabled={p.type === 'title'} onChange={() => toggleColumn(p.id)} />
                <span className="text-[0.875rem]" style={{ color: 'var(--tblr-text)' }}>{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </KbPopover>
    </>
  );
}
