import React, { useState, useEffect, useRef } from 'react';
import { IconSearch, IconMapPin } from '@tabler/icons-react';

interface AddressAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect?: (details: {
    fullAddress: string;
    city?: string;
    zipcode?: string;
    street?: string;
    banId?: string;
    cityCode?: string;
  }) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
}

interface AddressFeature {
  properties: {
    label: string;
    score: number;
    housenumber?: string;
    id: string;
    type: string;
    name: string;
    postcode: string;
    citycode: string;
    x: number;
    y: number;
    city: string;
    context: string;
    importance: number;
    street?: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
}

export function AddressAutocomplete({ label, value, onChange, onSelect, placeholder, required, id }: AddressAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<AddressFeature[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Update internal query when prop value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Handle outside click to close suggestions
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

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmedQuery = query.trim();
      // Check if query starts with a number or letter and is at least 3 chars long
      const isValid = /^[a-zA-Z0-9]/.test(trimmedQuery) && trimmedQuery.length >= 3;
      
      if (trimmedQuery && isValid && showSuggestions) {
        fetchAddresses(trimmedQuery);
      } else if (!trimmedQuery) {
        setSuggestions([]);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [query, showSuggestions]);

  const fetchAddresses = async (searchQuery: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/address-search?q=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          setSuggestions(data.features || []);
        } else {
          console.error('Address API returned non-JSON response');
          setSuggestions([]);
        }
      } else {
        let errorMsg = `Failed to fetch addresses (Status: ${response.status})`;
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMsg = errorData.error || errorData.details || errorMsg;
          } else {
            const text = await response.text();
            if (text && text.length < 100) errorMsg = text;
          }
        } catch (e) {
          // Ignore parse errors
        }
        console.error('Failed to fetch addresses:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error("Error fetching addresses:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    onChange(newValue); // Update parent immediately with raw input
    setShowSuggestions(true);
  };

  const handleSelectAddress = (feature: AddressFeature) => {
    const fullAddress = feature.properties.label;
    setQuery(fullAddress);
    setSuggestions([]);
    setShowSuggestions(false);
    
    // Pass raw value back
    onChange(fullAddress);
    
    // Pass detailed info back to parent via onSelect
    if (onSelect) {
      onSelect({
        fullAddress,
        city: feature.properties.city,
        zipcode: feature.properties.postcode,
        street: feature.properties.street || feature.properties.name,
        banId: feature.properties.id,
        cityCode: feature.properties.citycode
      });
    }
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
          id={id}
          type="text"
          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm text-zinc-900 dark:text-white pl-9"
          value={query || ''}
          onChange={handleInputChange}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder || "Search address..."}
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
          {suggestions.map((feature) => (
            <button
              key={feature.properties.id}
              className="w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-start gap-2 transition-colors"
              onClick={() => handleSelectAddress(feature)}
              type="button"
            >
              <IconMapPin className="shrink-0 mt-0.5 text-zinc-400" size={16} />
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">{feature.properties.label}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{feature.properties.context}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
