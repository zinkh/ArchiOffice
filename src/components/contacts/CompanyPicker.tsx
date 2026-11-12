// Choix de la société de rattachement : champ de recherche + liste déroulante des
// entreprises du cabinet, avec proposition d'en créer une quand rien ne correspond.
// La liste s'affiche dans le flux (pas en surimpression) : la fiche parente coupe
// ce qui dépasse (overflow-hidden), une liste flottante serait tronquée.
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBuilding, IconPlus, IconSearch, IconX } from '@tabler/icons-react';

export interface CompanyChoice {
  id: string;
  name: string;
  detail?: string;
}

interface Props {
  choices: CompanyChoice[];
  /** Société actuellement rattachée (null = aucune). */
  value: CompanyChoice | null;
  /** Nom proposé pour la création quand le champ est vide (société saisie sur la fiche). */
  suggestedName?: string;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => Promise<void> | void;
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const MAX_RESULTS = 8;
const BLUR_CLOSE_DELAY_MS = 150;

export function CompanyPicker({ choices, value, suggestedName, onSelect, onCreate }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const typed = query.trim();
  const needle = normalize(typed);

  const results = useMemo(() => {
    if (!needle) return choices.slice(0, MAX_RESULTS);
    return choices.filter(c => normalize(`${c.name} ${c.detail || ''}`).includes(needle)).slice(0, MAX_RESULTS);
  }, [choices, needle]);

  // On propose de créer ce qui est tapé, ou à défaut la société déjà saisie sur la fiche.
  const createName = typed || (suggestedName || '').trim();
  const exactMatch = !!createName && choices.some(c => normalize(c.name) === normalize(createName));
  const canCreate = !!createName && !exactMatch;
  const optionCount = results.length + (canCreate ? 1 : 0);

  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  const pick = (id: string | null) => { onSelect(id); close(); inputRef.current?.blur(); };
  const create = async () => {
    if (busy || !canCreate) return;
    setBusy(true);
    try { await onCreate(createName); close(); } finally { setBusy(false); }
  };
  const choose = (index: number) => {
    if (index < results.length) pick(results[index].id);
    else void create();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, Math.max(optionCount - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && optionCount > 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { close(); }
  };

  const listId = 'company-picker-list';
  const border = '1px solid var(--tblr-border)';

  return (
    <div className="space-y-1.5">
      {value && (
        <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm" style={{ background: 'var(--tblr-primary-lt)', border }}>
          <span className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--tblr-text)' }}>
            <IconBuilding size={15} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />
            <span className="truncate">{value.name}</span>
          </span>
          <button type="button" aria-label={t('contacts_company_detach')} title={t('contacts_company_detach')}
            className="shrink-0 p-1 rounded pointer-coarse:min-h-11 pointer-coarse:min-w-11 inline-flex items-center justify-center"
            style={{ color: 'var(--tblr-muted)' }} onClick={() => pick(null)}>
            <IconX size={14} />
          </button>
        </div>
      )}

      <div className="relative">
        <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--tblr-muted)' }} />
        <input ref={inputRef} type="text" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          autoComplete="off" value={query} placeholder={value ? t('contacts_company_change') : t('contacts_company_search')}
          className="w-full pl-8 pr-2 py-1.5 rounded-md text-sm pointer-coarse:min-h-11"
          style={{ background: 'var(--tblr-surface)', border, color: 'var(--tblr-text)' }}
          onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          // Un clic sur une option déclenche d'abord le blur : on referme après coup.
          onBlur={() => window.setTimeout(close, BLUR_CLOSE_DELAY_MS)}
          onKeyDown={onKeyDown} />
      </div>

      {open && (
        <ul id={listId} role="listbox" className="rounded-md overflow-y-auto max-h-56" style={{ background: 'var(--tblr-surface)', border }}>
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={c.id === value?.id}>
              <button type="button" className="w-full text-left px-3 py-2 text-sm pointer-coarse:min-h-11"
                style={{ background: i === active ? 'var(--tblr-primary-lt)' : 'transparent', color: 'var(--tblr-text)' }}
                onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(c.id)}>
                <span className="block truncate">{c.name}</span>
                {c.detail && <span className="block text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{c.detail}</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li role="presentation" className="px-3 pt-2 pb-1 text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_company_no_result')}</li>
          )}
          {canCreate && (
            <li role="option" aria-selected={false} style={{ borderTop: results.length ? border : undefined }}>
              <button type="button" disabled={busy} className="w-full text-left px-3 py-2 text-sm font-medium flex items-center gap-2 pointer-coarse:min-h-11 disabled:opacity-60"
                style={{ background: active === results.length ? 'var(--tblr-primary-lt)' : 'transparent', color: 'var(--tblr-primary)' }}
                onMouseEnter={() => setActive(results.length)} onMouseDown={e => e.preventDefault()} onClick={() => void create()}>
                <IconPlus size={14} className="shrink-0" />
                <span className="truncate">{t('contacts_company_create_named', { name: createName })}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
