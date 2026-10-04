import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconDots, IconX } from '@tabler/icons-react';
import { cn } from '../../../lib/utils';
import { ToolbarMenu } from './ToolbarMenu';
import type { ToolbarAction } from './proToolbar';

export interface SelectionAction extends ToolbarAction {
  /** Reste dans la barre sur téléphone ; sinon l'action passe dans « Plus ». */
  mobile?: boolean;
  /** Sépare visuellement un groupe du précédent (bureau). */
  groupStart?: boolean;
  /** Au bureau, icône seule (le libellé passe en infobulle et en nom accessible). */
  iconOnly?: boolean;
}

interface SelectionBarProps {
  /** Libellé du nombre d'éléments sélectionnés, ex. « 2 articles sélectionnés ». */
  label: string;
  actions: SelectionAction[];
  onClear: () => void;
  isMobile: boolean;
}

/**
 * Barre des actions sur la sélection : elle n'existe que tant que quelque
 * chose est sélectionné, flotte au bas du tableau au bureau et se fixe au bas
 * de l'écran sur téléphone, à portée de pouce. Le parent doit être
 * `relative` pour la version bureau.
 */
export function SelectionBar({ label, actions, onClear, isMobile }: SelectionBarProps) {
  const { t } = useTranslation();

  if (isMobile) {
    const primary = actions.filter(a => a.mobile);
    const rest = actions.filter(a => !a.mobile);
    return (
      <div
        role="toolbar"
        aria-label={t('pro_selection_toolbar')}
        className="fixed inset-x-2 z-40 flex flex-col gap-1 p-2 rounded-lg border no-print"
        style={{
          bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)',
          boxShadow: '0 6px 24px rgba(29,39,59,.16)',
        }}
      >
        <div className="flex items-center justify-between px-1">
          <span role="status" className="text-[0.8125rem] font-semibold">{label}</span>
          <button type="button" onClick={onClear} aria-label={t('pro_selection_clear')} className="w-11 h-8 inline-flex items-center justify-center rounded" style={{ color: 'var(--tblr-muted)' }}>
            <IconX size={18} aria-hidden />
          </button>
        </div>
        <div className="flex justify-between">
          {primary.map(action => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.hint}
              className="flex flex-col items-center justify-center gap-0.5 min-w-14 h-[3.25rem] px-1 rounded-md text-[0.6875rem] font-medium disabled:opacity-40"
              style={action.danger && !action.disabled ? { color: 'var(--tblr-danger)' } : undefined}
            >
              <span aria-hidden className="flex">{action.icon}</span>
              {action.label}
            </button>
          ))}
          {rest.length > 0 && (
            <ToolbarMenu
              entries={rest}
              onSelect={entry => entry.onClick()}
              align="end"
              ariaLabel={t('pro_selection_more')}
              triggerClassName="flex flex-col items-center justify-center gap-0.5 min-w-14 h-[3.25rem] px-1 rounded-md text-[0.6875rem] font-medium"
              trigger={<><IconDots size={20} aria-hidden />{t('pro_selection_more_short')}</>}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 no-print">
      <div
        role="toolbar"
        aria-label={t('pro_selection_toolbar')}
        className="pointer-events-auto flex items-center gap-1 pl-3 pr-1 py-1 rounded-lg border max-w-full overflow-x-auto"
        style={{
          background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)',
          boxShadow: '0 6px 24px rgba(29,39,59,.16)',
        }}
      >
        <span role="status" className="text-[0.8125rem] font-semibold whitespace-nowrap mr-2">{label}</span>
        {actions.map(action => (
          <React.Fragment key={action.id}>
            {action.groupStart && <span aria-hidden className="w-px h-5 mx-1" style={{ background: 'var(--tblr-border)' }} />}
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              title={[action.iconOnly ? action.label : '', action.hint, action.shortcut].filter(Boolean).join(' · ') || undefined}
              aria-label={action.iconOnly ? action.label : undefined}
              aria-keyshortcuts={action.shortcut ? action.shortcut.replace(/ /g, '') : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 rounded-[var(--tblr-radius)] text-[0.8125rem] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] disabled:opacity-40 disabled:cursor-not-allowed',
                action.iconOnly ? 'w-8 justify-center' : 'px-2',
                !action.disabled && 'hover:bg-[var(--tblr-surface-2)]',
              )}
              style={action.danger && !action.disabled ? { color: 'var(--tblr-danger)' } : undefined}
            >
              <span aria-hidden className="flex">{action.icon}</span>
              {!action.iconOnly && action.label}
            </button>
          </React.Fragment>
        ))}
        <span aria-hidden className="w-px h-5 mx-1" style={{ background: 'var(--tblr-border)' }} />
        <button
          type="button"
          onClick={onClear}
          aria-label={t('pro_selection_clear')}
          title={`${t('pro_selection_clear')} · Échap`}
          className="w-8 h-8 inline-flex items-center justify-center rounded-[var(--tblr-radius)] hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]"
          style={{ color: 'var(--tblr-muted)' }}
        >
          <IconX size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
