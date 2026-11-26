// Sélecteur d'étiquettes colorées d'une colonne « choix » ou « choix multiple » : cocher des options,
// en créer à la volée (couleur suivante de la palette) et changer la couleur d'une option.
import { useMemo, useRef, useState } from 'react';
import { IconCheck, IconPalette, IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { KB_TAG_COLORS, type KbOption, type KbTagColor } from '../../lib/kb';
import { foldText } from '../../lib/slashMenu';
import { KbPopover } from './KbPopover';
import { KbSwatch, KbTag } from './KbTag';

interface KbTagSelectProps {
  options: KbOption[];
  /** Ids des options choisies. */
  value: string[];
  multiple: boolean;
  /** Libellé accessible de la colonne. */
  label: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
  /** Remplace la liste des options de la colonne (création ou changement de couleur) ; rend la liste enregistrée. */
  onOptionsChange: (next: KbOption[]) => Promise<KbOption[]>;
}

/** Couleur proposée à une nouvelle option : la palette tourne, pour que deux étiquettes voisines diffèrent. */
export function nextKbColor(count: number): KbTagColor {
  return KB_TAG_COLORS[(count + 1) % KB_TAG_COLORS.length];
}

export function KbTagSelect({ options, value, multiple, label, disabled, onChange, onOptionsChange }: KbTagSelectProps) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(() => value.map(id => options.find(o => o.id === id)).filter((o): o is KbOption => !!o), [value, options]);
  const q = foldText(query.trim());
  const visible = options.filter(o => !q || foldText(o.label).includes(q));
  const canCreate = !!query.trim() && !options.some(o => foldText(o.label) === q);

  const close = () => { setOpen(false); setQuery(''); setColorFor(null); };

  const toggle = (id: string) => {
    if (multiple) onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
    else { onChange(value.includes(id) ? [] : [id]); close(); }
  };

  const create = async () => {
    const labelText = query.trim();
    if (!labelText || busy) return;
    setBusy(true);
    try {
      const saved = await onOptionsChange([...options, { id: '', label: labelText, color: nextKbColor(options.length) }]);
      const created = saved.find(o => foldText(o.label) === foldText(labelText));
      if (created) toggle(created.id);
      setQuery('');
    } finally {
      setBusy(false);
    }
  };

  const recolor = async (id: string, color: KbTagColor) => {
    setBusy(true);
    try { await onOptionsChange(options.map(o => (o.id === id ? { ...o, color } : o))); }
    finally { setBusy(false); setColorFor(null); }
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="w-full min-h-8 flex flex-wrap items-center gap-1 text-left rounded px-1 py-0.5 hover:bg-[var(--tblr-surface-2)] disabled:hover:bg-transparent"
      >
        {chosen.length === 0
          ? <span className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_empty_value')}</span>
          : chosen.map(o => <KbTag key={o.id} option={o} />)}
      </button>

      <KbPopover anchorRef={anchor} open={open} onClose={close} label={label} width={272}>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) { e.preventDefault(); void create(); } }}
          placeholder={t('kb_tag_search') as string}
          aria-label={t('kb_tag_search') as string}
          className="tblr-input w-full mb-1"
        />
        <ul role="listbox" aria-multiselectable={multiple} aria-label={label}>
          {visible.map(option => (
            <li key={option.id}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={value.includes(option.id)}
                  onClick={() => toggle(option.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--tblr-surface-2)]"
                >
                  <span className="w-4 shrink-0">{value.includes(option.id) && <IconCheck size={14} aria-hidden />}</span>
                  <KbTag option={option} />
                </button>
                <button
                  type="button"
                  aria-label={`${t('kb_tag_color')} : ${option.label}`}
                  aria-expanded={colorFor === option.id}
                  onClick={() => setColorFor(colorFor === option.id ? null : option.id)}
                  className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]"
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  <IconPalette size={14} aria-hidden />
                </button>
              </div>
              {colorFor === option.id && (
                <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-1" role="group" aria-label={t('kb_tag_color') as string}>
                  {KB_TAG_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      aria-label={t(`kb_color_${color}`) as string}
                      aria-pressed={option.color === color}
                      disabled={busy}
                      onClick={() => void recolor(option.id, color)}
                      className="p-0.5 rounded-full border"
                      style={{ borderColor: option.color === color ? 'var(--tblr-primary)' : 'transparent' }}
                    >
                      <KbSwatch color={color} />
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {visible.length === 0 && !canCreate && <p className="px-2 py-1.5 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_tag_none')}</p>}
        {canCreate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[0.875rem] hover:bg-[var(--tblr-surface-2)]"
            style={{ color: 'var(--tblr-text)' }}
          >
            <IconPlus size={14} aria-hidden />
            {t('kb_tag_create', { name: query.trim() })}
          </button>
        )}
      </KbPopover>
    </>
  );
}
