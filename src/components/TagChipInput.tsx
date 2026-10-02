import { useState } from 'react';
import { IconX, IconPlus } from '@tabler/icons-react';
import { cn } from '../lib/utils';

interface TagChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Valeurs déjà utilisées ailleurs (autres contacts), proposées en complétion. */
  suggestions?: string[];
  placeholder?: string;
  className?: string;
}

/**
 * Saisie multi-valeurs sous forme de puces (ajout par Entrée/virgule, retrait
 * par clic sur la croix) — le même principe que le champ "tags" existant,
 * mais structuré en tableau plutôt qu'une chaîne libre, pour permettre de
 * filtrer dessus (Corps d'état / Spécialité sur les contacts).
 */
export function TagChipInput({ value, onChange, suggestions = [], placeholder, className }: TagChipInputProps) {
  const [draft, setDraft] = useState('');

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (!value.some(v => v.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setDraft('');
  };

  const removeTag = (tag: string) => onChange(value.filter(v => v !== tag));

  const remainingSuggestions = suggestions.filter(
    s => !value.some(v => v.toLowerCase() === s.toLowerCase()) && s.toLowerCase().includes(draft.toLowerCase())
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap gap-1.5">
        {value.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
          >
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="hover:opacity-70">
              <IconX size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(draft);
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              removeTag(value[value.length - 1]);
            }
          }}
          placeholder={placeholder}
          className="w-full px-3 py-1.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          list={undefined}
        />
        {draft && remainingSuggestions.length > 0 && (
          <div
            className="absolute z-10 top-full left-0 right-0 mt-1 rounded-lg border shadow-lg max-h-40 overflow-y-auto"
            style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
          >
            {remainingSuggestions.slice(0, 8).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => addTag(s)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1.5"
                style={{ color: 'var(--tblr-text)' }}
              >
                <IconPlus size={11} style={{ color: 'var(--tblr-muted)' }} />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
