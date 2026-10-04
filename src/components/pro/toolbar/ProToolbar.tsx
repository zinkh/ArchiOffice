import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconDots } from '@tabler/icons-react';
import { cn } from '../../../lib/utils';
import { ToolbarMenu } from './ToolbarMenu';
import { foldForMobile, invokeToolbarAction, type ToolbarItem, type ToolbarMenuEntry } from './proToolbar';

interface ProToolbarProps {
  /** Actions du document affiché, telles qu'au dernier changement d'apparence. */
  items: ToolbarItem[];
  /** Dernière version des actions, relue au moment du clic. */
  resolve: () => ToolbarItem[];
  /** Actions du dossier PRO (contrôle, versions, comparaison…), menu « ⋯ ». */
  dossierEntries: ToolbarMenuEntry[];
  dossierLabel: string;
  isMobile: boolean;
}

export const toolbarButtonClass = (opts: { accent?: boolean; pressed?: boolean; iconOnly?: boolean } = {}) => cn(
  'relative inline-flex items-center justify-center gap-1.5 h-8 pointer-coarse:h-11 rounded-[var(--tblr-radius)] border text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] disabled:opacity-45 disabled:cursor-not-allowed',
  opts.iconOnly ? 'w-8 pointer-coarse:w-11' : 'px-2.5 pointer-coarse:px-3.5',
  opts.accent || opts.pressed
    ? 'border-transparent bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)] font-semibold'
    : 'border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]',
);

/**
 * Partie droite de la ligne des sous-onglets : les actions du document, puis
 * le menu « ⋯ » du dossier. Sur téléphone, seules les actions marquées
 * `mobile` restent visibles, les autres rejoignent le menu « ⋯ ».
 */
export function ProToolbar({ items, resolve, dossierEntries, dossierLabel, isMobile }: ProToolbarProps) {
  const { t } = useTranslation();
  const run = (id: string, value?: string) => { invokeToolbarAction(resolve(), id, value); };
  const { visible, folded } = isMobile ? foldForMobile(items) : { visible: items, folded: [] as ToolbarMenuEntry[] };
  const menuEntries: ToolbarMenuEntry[] = folded.length
    ? [...folded, { id: '__dossier_sep', separator: true }, { id: '__dossier_heading', heading: dossierLabel }, ...dossierEntries]
    : dossierEntries;

  // Les entrées du dossier appartiennent à ProTab (fraîches à chaque rendu) ;
  // celles du document sont relues dans l'atelier.
  const dossierIds = new Set(dossierEntries.map(e => e.id));
  const selectEntry = (entry: { id: string; onClick: () => void }) => {
    if (dossierIds.has(entry.id)) entry.onClick();
    else run(entry.id);
  };

  return (
    <div role="toolbar" aria-label={t('pro_toolbar_label')} className="flex items-center gap-2 min-w-0">
      {visible.map(item => {
        if (item.kind === 'button') {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => run(item.id)}
              disabled={item.disabled}
              aria-pressed={item.pressed}
              title={item.hint}
              className={toolbarButtonClass({ accent: item.accent, pressed: item.pressed })}
            >
              <span aria-hidden className="flex">{item.icon}</span>
              {item.label}
              {item.badge && (
                <span aria-hidden className="absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-[var(--tblr-surface)]" style={{ background: 'var(--tblr-primary)' }} />
              )}
            </button>
          );
        }
        if (item.kind === 'menu') {
          return (
            <ToolbarMenu
              key={item.id}
              entries={item.entries}
              onSelect={selectEntry}
              title={item.hint}
              triggerClassName={toolbarButtonClass({ accent: item.accent })}
              trigger={<>
                <span aria-hidden className="flex">{item.icon}</span>
                {item.label}
                <IconChevronDown size={14} aria-hidden />
              </>}
            />
          );
        }
        return (
          <div key={item.id} className="inline-flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--tblr-muted)' }} id={`${item.id}-label`}>{item.label}</span>
            <div role="radiogroup" aria-labelledby={`${item.id}-label`} className="inline-flex gap-0.5 p-0.5 rounded-md" style={{ background: 'var(--tblr-surface-2)' }}>
              {item.options.map(option => {
                const selected = option.id === item.value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={option.disabled}
                    onClick={() => run(item.id, option.id)}
                    className={cn(
                      'h-7 px-2.5 rounded text-[0.8125rem] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] disabled:opacity-45 disabled:cursor-not-allowed',
                      selected ? 'font-semibold' : 'font-medium',
                    )}
                    style={selected
                      ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' }
                      : { color: 'var(--tblr-muted)' }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {menuEntries.length > 0 && (
        <ToolbarMenu
          entries={menuEntries}
          onSelect={selectEntry}
          align="end"
          ariaLabel={dossierLabel}
          title={dossierLabel}
          triggerClassName={toolbarButtonClass({ iconOnly: true })}
          trigger={<IconDots size={16} aria-hidden />}
        />
      )}
    </div>
  );
}
