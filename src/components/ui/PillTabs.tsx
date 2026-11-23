import React from 'react';
import { navigateTabList } from '../../lib/tabListNavigation';
import { cn } from '../../lib/utils';
import { useHorizontalScrollHints } from '../../hooks/useHorizontalScrollHints';

export interface PillTabItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  /** Court repère affiché à côté du libellé (ex. « hors mission »). */
  badge?: string;
  /** Complément discret après le libellé (ex. le sigle de mission « PRO »). */
  hint?: string;
  /** Infobulle, et nom complet pour un lecteur d'écran quand le libellé est un sigle. */
  title?: string;
}

interface PillTabsProps {
  tabs: PillTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  /** Nom de la barre d'onglets, annoncé par un lecteur d'écran. */
  ariaLabel?: string;
  /** « underline » : onglets soulignés sur un filet, sans fond (fiche affaire). */
  variant?: 'pill' | 'underline';
}

export function PillTabs({ tabs, activeId, onChange, className, ariaLabel, variant = 'pill' }: PillTabsProps) {
  const underline = variant === 'underline';
  const scrollRef = useHorizontalScrollHints<HTMLDivElement>('[aria-selected="true"]', activeId);
  // Flèches gauche/droite, Début et Fin entre les onglets (motif ARIA « tabs »,
  // activation automatique) : seul l'onglet actif est dans l'ordre de tabulation.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) =>
    navigateTabList(e, tabs.map(t => t.id), activeId, onChange);

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'scroll-fade-x flex items-center overflow-x-auto max-w-full',
        underline ? 'gap-0 border-b' : 'inline-flex gap-1 p-1 rounded-lg',
        className,
      )}
      style={underline ? { borderColor: 'var(--tblr-border)' } : { background: 'var(--tblr-surface-2)' }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tab.title}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm whitespace-nowrap transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--tblr-primary)]',
              underline ? '-mb-px border-b-2' : 'rounded-md',
              isActive ? 'font-semibold' : underline ? 'font-medium hover:text-[var(--tblr-text)]' : 'font-medium hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)]'
            )}
            style={
              underline
                ? { borderColor: isActive ? 'var(--tblr-primary)' : 'transparent', color: isActive ? 'var(--tblr-text)' : 'var(--tblr-muted)' }
                : isActive
                  ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' }
                  : { color: 'var(--tblr-muted)' }
            }
          >
            {Icon && <Icon size={16} aria-hidden />}
            {tab.label}
            {tab.hint && (
              <span className="font-mono text-[0.6875rem] font-medium" style={{ color: 'var(--tblr-muted)' }}>
                {tab.hint}
              </span>
            )}
            {tab.badge && (
              <span
                className="px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold"
                style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
