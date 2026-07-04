import React from 'react';
import { cn } from '../../lib/utils';

export type StatTileColor = 'blue' | 'green' | 'red' | 'amber' | 'indigo' | 'orange' | 'neutral';

const ACCENT_STYLES: Record<Exclude<StatTileColor, 'neutral'>, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40', icon: 'text-blue-600 dark:text-blue-400' },
  green: { bg: 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/40', icon: 'text-green-600 dark:text-green-400' },
  red: { bg: 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40', icon: 'text-red-600 dark:text-red-400' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40', icon: 'text-amber-600 dark:text-amber-400' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/40', icon: 'text-indigo-600 dark:text-indigo-400' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/40', icon: 'text-orange-600 dark:text-orange-400' },
};

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  color?: StatTileColor;
  icon?: React.ElementType;
  className?: string;
}

export function StatTile({ label, value, sub, color = 'neutral', icon: Icon, className }: StatTileProps) {
  const isNeutral = color === 'neutral';

  return (
    <div
      className={cn('relative rounded-lg overflow-hidden', isNeutral ? 'p-6' : cn('p-4', ACCENT_STYLES[color].bg), className)}
      style={isNeutral ? { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' } : undefined}
    >
      {Icon && (
        <Icon
          size={64}
          className={cn('absolute -right-3 -bottom-3 opacity-10 pointer-events-none', !isNeutral && ACCENT_STYLES[color].icon)}
          style={isNeutral ? { color: 'var(--tblr-text)' } : undefined}
        />
      )}
      <div className="relative flex items-center gap-2 mb-1">
        {Icon && (
          <Icon size={16} className={isNeutral ? undefined : ACCENT_STYLES[color].icon} style={isNeutral ? { color: 'var(--tblr-muted)' } : undefined} />
        )}
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{label}</span>
      </div>
      <div className="relative text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{value}</div>
      {sub && <div className="relative text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{sub}</div>}
    </div>
  );
}
