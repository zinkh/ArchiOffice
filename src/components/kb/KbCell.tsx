// Cellule éditable d'une propriété de la « Base de données » (tableau et en-tête d'une ligne ouverte en
// page) : un éditeur par type de colonne. La valeur est enregistrée à la sortie du champ (ou à l'appui sur
// Entrée), jamais à chaque frappe : le tableau applique la valeur tout de suite puis l'envoie au serveur.
import { useEffect, useState } from 'react';
import { IconExternalLink } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { KbOption, KbProperty } from '../../lib/kb';
import { KbTagSelect } from './KbTagSelect';

interface KbCellProps {
  property: KbProperty;
  /** Valeur courante : le titre de la ligne pour la colonne titre, sinon `properties[property.id]`. */
  value: unknown;
  disabled?: boolean;
  onCommit: (value: unknown) => void;
  onOptionsChange: (options: KbOption[]) => Promise<KbOption[]>;
}

const asText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** Adresse ouvrable : seulement http(s), jamais javascript: ni data:. */
function safeHref(value: string): string | null {
  try {
    const url = new URL(/^[a-z]+:/i.test(value) ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

export function KbCell({ property, value, disabled, onCommit, onOptionsChange }: KbCellProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(asText(value));
  useEffect(() => { setDraft(asText(value)); }, [value]);

  const commit = () => {
    if (draft === asText(value)) return;
    if (property.type === 'number') onCommit(draft.trim() === '' ? null : draft);
    else onCommit(property.type === 'title' ? draft : (draft === '' ? null : draft));
  };
  const onKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); (event.target as HTMLElement).blur(); }
    if (event.key === 'Escape') { setDraft(asText(value)); (event.target as HTMLElement).blur(); }
  };
  const aria = property.name;

  switch (property.type) {
    case 'select':
    case 'multi_select': {
      const ids = Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value ? [value] : [];
      return (
        <KbTagSelect
          options={property.options}
          value={ids}
          multiple={property.type === 'multi_select'}
          label={aria}
          disabled={disabled}
          onChange={next => onCommit(property.type === 'multi_select' ? next : (next[0] ?? null))}
          onOptionsChange={onOptionsChange}
        />
      );
    }
    case 'checkbox':
      return (
        <input
          type="checkbox"
          aria-label={aria}
          disabled={disabled}
          checked={value === true}
          onChange={e => onCommit(e.target.checked)}
          className="w-4 h-4 mx-1 align-middle"
        />
      );
    case 'date':
      return (
        <input
          type="date"
          aria-label={aria}
          disabled={disabled}
          value={asText(value).slice(0, 10)}
          onChange={e => onCommit(e.target.value || null)}
          className="w-full bg-transparent outline-none px-1 py-1 rounded focus:bg-[var(--tblr-surface-2)]"
          style={{ color: 'var(--tblr-text)' }}
        />
      );
    case 'relation':
      return <span className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{Array.isArray(value) && value.length ? t('kb_relation_count', { count: value.length }) : t('kb_empty_value')}</span>;
    case 'url': {
      const href = safeHref(draft);
      return (
        <div className="flex items-center gap-1">
          <input
            aria-label={aria}
            disabled={disabled}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            placeholder={t('kb_empty_value') as string}
            className="w-full bg-transparent outline-none px-1 py-1 rounded focus:bg-[var(--tblr-surface-2)]"
            style={{ color: 'var(--tblr-primary)' }}
          />
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${t('kb_open_link')} : ${aria}`} className="p-1 rounded hover:bg-[var(--tblr-surface-2)]" style={{ color: 'var(--tblr-muted)' }}>
              <IconExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      );
    }
    case 'text':
    case 'title':
    case 'number':
    default:
      return (
        <textarea
          aria-label={aria}
          disabled={disabled}
          rows={1}
          value={draft}
          inputMode={property.type === 'number' ? 'decimal' : undefined}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          placeholder={property.type === 'title' ? (t('kb_untitled') as string) : (t('kb_empty_value') as string)}
          className="block w-full resize-none bg-transparent outline-none px-1 py-1 rounded focus:bg-[var(--tblr-surface-2)] field-sizing-content"
          style={{ color: 'var(--tblr-text)', fontWeight: property.type === 'title' ? 500 : undefined }}
        />
      );
  }
}
