import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconSearch, IconUser, IconPlus } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { Contact } from '../types';
import { cn } from '../lib/utils';

interface ContactAutocompleteProps {
  contacts: Contact[];
  value: string; // contact_id
  onChange: (contactId: string) => void;
  onAddNew?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  addNewLabel?: string;
}

export function ContactAutocomplete({ contacts, value, onChange, onAddNew, placeholder, className, inputClassName, addNewLabel = "Add New Contact" }: ContactAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Find the selected contact to display its name
  const selectedContact = contacts.find(c => c.id === value);
  
  useEffect(() => {
    if (selectedContact) {
      setQuery(`${selectedContact.first_name} ${selectedContact.last_name}${selectedContact.company_name ? ` (${selectedContact.company_name})` : ''}`);
    } else if (!value) {
      setQuery('');
    }
  }, [value, selectedContact]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
        if (selectedContact) {
          setQuery(`${selectedContact.first_name} ${selectedContact.last_name}${selectedContact.company_name ? ` (${selectedContact.company_name})` : ''}`);
        } else {
          setQuery('');
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef, selectedContact]);

  // Recalculate dropdown position whenever it opens or the window scrolls/resizes
  useEffect(() => {
    if (!showSuggestions) { setDropdownPos(null); return; }
    function recalc() {
      if (!wrapperRef.current) return;
      const r = wrapperRef.current.getBoundingClientRect();
      setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    recalc();
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc, true);
      window.removeEventListener('resize', recalc);
    };
  }, [showSuggestions]);

  const filteredContacts = contacts.filter(c => {
    const firstName = (c.first_name || '').toLowerCase();
    const lastName = (c.last_name || '').toLowerCase();
    const fullName = `${firstName} ${lastName}`.toLowerCase();
    const company = (c.company_name || '').toLowerCase();
    const category = (c.category || '').toLowerCase();
    const search = query.toLowerCase();
    return fullName.includes(search) || company.includes(search) || category.includes(search) || firstName.includes(search) || lastName.includes(search);
  }).slice(0, 10);

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className={cn("w-full px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white pl-8 pr-8", inputClassName)}
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            if (!e.target.value) onChange('');
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder || "Search contact..."}
        />
        <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
        {onAddNew && (
          <button
            type="button"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onAddNew();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 p-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors"
            title={addNewLabel}
          >
            <IconPlus size={14} />
          </button>
        )}
      </div>

      {showSuggestions && dropdownPos && createPortal(
        <div
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
          className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-60 overflow-y-auto"
        >
          {onAddNew && (
            <button
              type="button"
              onClick={() => { onAddNew(); setShowSuggestions(false); }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 transition-colors border-b border-zinc-100 dark:border-zinc-700 text-blue-600 dark:text-blue-400 font-bold sticky top-0 bg-white dark:bg-zinc-800 z-10"
            >
              <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <IconPlus size={12} />
              </div>
              {addNewLabel}
            </button>
          )}

          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors"
              onClick={() => { onChange(contact.id); setShowSuggestions(false); }}
              type="button"
            >
              <IconUser className="shrink-0 text-zinc-400" size={14} />
              <div className="truncate text-left">
                <p className="font-medium text-zinc-900 dark:text-white truncate">
                  {contact.first_name} {contact.last_name}
                </p>
                {contact.company_name && (
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{contact.company_name}</p>
                )}
              </div>
            </button>
          ))}

          {filteredContacts.length === 0 && !onAddNew && (
            <div className="px-3 py-4 text-center text-zinc-500 text-xs italic">
              No contacts found
            </div>
          )}

          {!onAddNew && (
            <Link
              to="/contacts"
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors border-t border-zinc-100 dark:border-zinc-700 text-blue-600 dark:text-blue-400 font-medium sticky bottom-0 bg-white dark:bg-zinc-800"
            >
              <IconPlus size={14} />
              {addNewLabel}
            </Link>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
