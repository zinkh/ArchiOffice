import React, { useState, useEffect, useRef } from 'react';
import { IconSearch, IconUser } from '@tabler/icons-react';
import { Contact } from '../types';

interface ContactAutocompleteProps {
  contacts: Contact[];
  value: string; // contact_id
  onChange: (contactId: string) => void;
  placeholder?: string;
  className?: string;
}

export function ContactAutocomplete({ contacts, value, onChange, placeholder, className }: ContactAutocompleteProps) {
  console.log('ContactAutocomplete contacts:', contacts);
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
        // Reset query to selected contact name if no selection was made
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

  const filteredContacts = contacts.filter(c => {
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const company = (c.company_name || '').toLowerCase();
    const search = query.toLowerCase();
    return fullName.includes(search) || company.includes(search);
  })?.slice(0, 10);

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white pl-8"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            if (!e.target.value) onChange('');
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder || "Search contact..."}
        />
        <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
      </div>

      {showSuggestions && query && filteredContacts.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors"
              onClick={() => {
                onChange(contact.id);
                setShowSuggestions(false);
              }}
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
        </div>
      )}
    </div>
  );
}
