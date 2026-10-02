import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown, IconSearch } from '@tabler/icons-react';
import { cn } from '../lib/utils';

export interface MultiSelectOption {
  value: string;
  /** Libellé complet, affiché dans la liste déroulante. */
  label: string;
  /** Libellé court pour les pastilles du bouton (repli sur `label`). */
  shortLabel?: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Texte du bouton quand rien n'est coché. */
  placeholder: string;
  /** Nombre de pastilles montrées sur le bouton avant « +N ». */
  maxChips?: number;
  tone?: 'green' | 'blue';
  /** Champ de recherche dans la liste (utile au-delà d'une dizaine d'options). */
  searchable?: boolean;
  /** Boutons « Tout » / « Aucun » en tête de liste. */
  bulkActions?: boolean;
  /** Nom accessible du bouton. */
  ariaLabel?: string;
  /** Remplace le résumé par pastilles : le bouton n'est alors que ce contenu (ex. une pastille de statut). */
  triggerContent?: React.ReactNode;
  /** Largeur minimale de la liste (px), pour un déclencheur étroit. */
  menuMinWidth?: number;
}

const TONES = {
  green: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
};

/**
 * Menu déroulant à cases à cocher : le bouton résume la sélection en quelques
 * pastilles puis « +N », la liste complète vit dans un popover (portail) pour
 * ne pas allonger les lignes d'un tableau. Même mécanique de popover que
 * EntrepriseAutocomplete.
 */
export function MultiSelectDropdown({
  options, selected, onChange, placeholder, maxChips = 2, tone = 'green',
  searchable = false, bulkActions = false, ariaLabel, triggerContent, menuMinWidth = 260,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    function onClickOutside(ev: MouseEvent) {
      const target = ev.target as Node;
      if (wrapperRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) { setPos(null); setFilter(''); return; }
    const recalc = () => {
      if (!wrapperRef.current) return;
      const r = wrapperRef.current.getBoundingClientRect();
      const width = Math.max(r.width, menuMinWidth);
      // Reste dans l'écran : bascule au-dessus du bouton s'il n'y a pas la place dessous.
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow < 300 && r.top > spaceBelow ? Math.max(8, r.top - 4 - 300) : r.bottom + 4;
      setPos({ top, left: Math.min(r.left, window.innerWidth - width - 8), width });
    };
    recalc();
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => { window.removeEventListener('scroll', recalc, true); window.removeEventListener('resize', recalc); };
  }, [open]);

  const selectedOptions = useMemo(
    () => options.filter(o => selected.includes(o.value)),
    [options, selected],
  );
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, filter]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);

  const shown = selectedOptions.slice(0, maxChips);
  const hidden = selectedOptions.length - shown.length;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        className={triggerContent
          ? 'text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full'
          : 'w-full min-h-[30px] text-left text-xs border border-[var(--tblr-border)] rounded-lg pl-2 pr-1.5 py-1 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-1'}
      >
        {triggerContent ? triggerContent : <>
        <span className="flex flex-wrap gap-1 flex-1 min-w-0">
          {selectedOptions.length === 0 && <span className="text-[var(--tblr-muted)]">{placeholder}</span>}
          {shown.map(o => (
            <span key={o.value} className={cn('px-1.5 py-0.5 rounded-full text-[0.6875rem] font-bold truncate max-w-[9rem]', TONES[tone])}>
              {o.shortLabel || o.label}
            </span>
          ))}
          {hidden > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[0.6875rem] font-bold bg-zinc-100 dark:bg-zinc-800 text-[var(--tblr-muted)]">+{hidden}</span>
          )}
        </span>
        <IconChevronDown size={13} className={cn('shrink-0 text-[var(--tblr-muted)] transition-transform', open && 'rotate-180')} />
        </>}
      </button>
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-multiselectable="true"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl flex flex-col max-h-[300px]"
        >
          {(searchable || bulkActions) && (
            <div className="p-1.5 border-b border-zinc-100 dark:border-zinc-700 flex items-center gap-1.5">
              {searchable && (
                <div className="relative flex-1">
                  <IconSearch size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
                  <input
                    autoFocus
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Rechercher…"
                    className="w-full text-xs border border-[var(--tblr-border)] rounded-md pl-6 pr-2 py-1 bg-white dark:bg-zinc-900 outline-none"
                  />
                </div>
              )}
              {bulkActions && (
                <>
                  <button type="button" onClick={() => onChange(options.map(o => o.value))} className="text-[0.6875rem] font-bold text-blue-600 hover:underline px-1">Tout</button>
                  <button type="button" onClick={() => onChange([])} className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] hover:underline px-1">Aucun</button>
                </>
              )}
            </div>
          )}
          <div className="overflow-y-auto p-1.5 flex flex-col gap-0.5">
            {visible.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="rounded w-3.5 h-3.5 shrink-0" />
                <span className="min-w-0">{o.label}</span>
              </label>
            ))}
            {visible.length === 0 && (
              <div className="px-2 py-3 text-center text-xs italic text-[var(--tblr-muted)]">Aucun résultat.</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
