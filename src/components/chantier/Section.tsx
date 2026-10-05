import React, { useId, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { cn } from '../../lib/utils';

/**
 * Bloc du compte-rendu. Repliable (l'état est mémorisé par section dans le
 * navigateur) : le compte-rendu est une longue page, et sur un téléphone on
 * referme ce qu'on ne saisit pas. L'action reste visible repliée, et passe sous
 * le titre quand la largeur manque plutôt que de sortir de l'écran.
 */
export function Section({ id, title, icon: Icon, action, children }: {
  id?: string;
  title: string;
  icon?: React.ComponentType<{ size?: number }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const storageKey = id ? `chantier:section:${id}` : null;
  const bodyId = useId();
  const [open, setOpen] = useState(() => {
    try { return storageKey ? localStorage.getItem(storageKey) !== '0' : true; } catch { return true; }
  });
  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try { if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* stockage indisponible : la section reste repliable */ }
      return next;
    });
  };
  return (
    <section id={id ? `chantier-${id}` : undefined} className="rounded-xl p-4 sm:p-5 scroll-mt-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
      <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2', open && 'mb-3')}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex items-center gap-2 min-w-0 text-left text-sm font-bold text-[var(--tblr-text)] pointer-coarse:min-h-11"
        >
          {Icon && <Icon size={18} />}
          <span className="min-w-0">{title}</span>
          <IconChevronDown size={16} className={cn('shrink-0 text-[var(--tblr-muted)] transition-transform', !open && '-rotate-90')} aria-hidden="true" />
        </button>
        {action && (
          <div className="min-w-0 max-w-full w-full sm:w-auto [&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto">
            {action}
          </div>
        )}
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}
