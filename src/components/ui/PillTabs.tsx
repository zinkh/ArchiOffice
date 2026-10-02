import React from 'react';
import { cn } from '../../lib/utils';

export interface PillTabItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  /** Court repère affiché à côté du libellé (ex. « hors mission »). */
  badge?: string;
}

interface PillTabsProps {
  tabs: PillTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function PillTabs({ tabs, activeId, onChange, className }: PillTabsProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-1 p-1 rounded-lg overflow-x-auto max-w-full', className)}
      style={{ background: 'var(--tblr-surface-2)' }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm whitespace-nowrap transition-colors shrink-0',
              isActive ? 'font-semibold' : 'font-medium hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)]'
            )}
            style={
              isActive
                ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' }
                : { color: 'var(--tblr-muted)' }
            }
          >
            {Icon && <Icon size={16} />}
            {tab.label}
            {tab.badge && (
              <span
                className="px-1.5 py-0.5 rounded text-[0.625rem] font-bold uppercase tracking-wide"
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
