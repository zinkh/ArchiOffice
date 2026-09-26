import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconBuilding, IconPlus } from '@tabler/icons-react';
import type { Contact } from '../types';

interface EntrepriseAutocompleteProps {
  /** Contacts déjà filtrés sur la catégorie « Entreprise » par l'appelant. */
  contacts: Contact[];
  /** Contact actuellement rattaché, s'il y en a un. */
  contactId?: string;
  /** Nom affiché quand aucun contact n'est encore rattaché (saisie historique). */
  fallbackName?: string;
  onSelect: (contact: Contact) => void;
  /** Le texte tapé ne correspond à aucun contact existant : proposé pour en créer un directement dans les Contacts. */
  onCreate: (name: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Autocomplete sur le nom d'entreprise des contacts, avec création directe
 * dans les Contacts quand la saisie ne correspond à rien d'existant — pensé
 * pour remplacer la liste déroulante de choix d'entreprise en phase de
 * consultation ACT, où une entreprise absente du fichier de contacts est le
 * cas courant, pas l'exception.
 */
export function EntrepriseAutocomplete({
  contacts, contactId, fallbackName, onSelect, onCreate, placeholder, className,
}: EntrepriseAutocompleteProps) {
  const selected = contacts.find(c => c.id === contactId);
  const [query, setQuery] = useState(selected?.company_name || fallbackName || '');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    setQuery(selected?.company_name || fallbackName || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, selected?.company_name, fallbackName]);

  useEffect(() => {
    function onClickOutside(ev: MouseEvent) {
      const target = ev.target as Node;
      if ((wrapperRef.current && wrapperRef.current.contains(target)) || (dropdownRef.current && dropdownRef.current.contains(target))) return;
      setOpen(false);
      setQuery(selected?.company_name || fallbackName || '');
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [selected, fallbackName]);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const recalc = () => {
      if (!wrapperRef.current) return;
      const r = wrapperRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    };
    recalc();
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc, true);
      window.removeEventListener('resize', recalc);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? contacts.filter(c => (c.company_name || `${c.first_name || ''} ${c.last_name || ''}`).toLowerCase().includes(q)).slice(0, 8)
    : contacts.slice(0, 8);
  const exactMatch = contacts.some(c => (c.company_name || '').trim().toLowerCase() === q);

  return (
    <div className={`relative ${className || ''}`} ref={wrapperRef}>
      <input
        type="text"
        className="w-full text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
        value={query}
        placeholder={placeholder || 'Rechercher ou créer une entreprise…'}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-64 overflow-y-auto"
        >
          {q && !exactMatch && (
            <button
              type="button"
              onClick={() => { onCreate(query.trim()); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 transition-colors border-b border-zinc-100 dark:border-zinc-700 text-blue-600 dark:text-blue-400 font-bold sticky top-0 bg-white dark:bg-zinc-800 z-10"
            >
              <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                <IconPlus size={12} />
              </div>
              Créer « {query.trim()} » dans les contacts
            </button>
          )}
          {matches.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-start gap-2 transition-colors"
            >
              <IconBuilding className="shrink-0 text-zinc-400 mt-0.5" size={14} />
              <div className="truncate text-left">
                <p className="font-medium text-zinc-900 dark:text-white truncate">
                  {c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
                </p>
                {!!(c.corps_etat && c.corps_etat.length) && (
                  <p className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400 truncate">{c.corps_etat.join(', ')}</p>
                )}
              </div>
            </button>
          ))}
          {matches.length === 0 && !q && (
            <div className="px-3 py-4 text-center text-zinc-500 text-xs italic">Aucune entreprise dans les contacts.</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
