import React, { useState, useEffect, useRef } from 'react';
import { IconSearch, IconBuilding } from '@tabler/icons-react';

interface CompanyAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string, details?: any) => void;
  placeholder?: string;
  required?: boolean;
}

export function CompanyAutocomplete({ label, value, onChange, placeholder, required }: CompanyAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [wrapperRef]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmedQuery = query.trim();
      if (trimmedQuery && trimmedQuery.length >= 3 && showSuggestions) {
        fetchCompanies(trimmedQuery);
      } else if (!trimmedQuery) {
        setSuggestions([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, showSuggestions]);

  const fetchCompanies = async (searchQuery: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(searchQuery)}&per_page=5`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.results || []);
      }
    } catch (error) {
      console.error("Error fetching companies:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    onChange(newValue);
    setShowSuggestions(true);
  };

  const handleSelectCompany = (company: any) => {
    const name = company.nom_complet || company.nom_raison_sociale;
    setQuery(name);
    setSuggestions([]);
    setShowSuggestions(false);
    
    onChange(name, {
      siren: company.siren,
      siret: company.siege?.siret,
      address: company.siege?.adresse,
      zipcode: company.siege?.code_postal,
      city: company.siege?.libelle_commune,
      activite: company.activite_principale,
      dirigeants: company.dirigeants
    });
  };

  return (
    <div className="relative" ref={wrapperRef}>
      {label && (
        <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white pl-9"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder || "Search company..."}
          required={required}
        />
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
        
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((company) => (
            <button
              key={company.siren}
              className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-start gap-2 transition-colors"
              onClick={() => handleSelectCompany(company)}
              type="button"
            >
              <IconBuilding className="shrink-0 mt-0.5 text-zinc-400" size={16} />
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">{company.nom_complet || company.nom_raison_sociale}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {company.siege?.code_postal} {company.siege?.libelle_commune} - SIREN: {company.siren}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
