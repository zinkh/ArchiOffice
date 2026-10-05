import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import {
  MAX_OPEN_PROJECT_TABS, closeProjectTab, pathAfterClosing, projectIdFromPath,
  touchProjectTab, useOpenProjectTabs,
} from '../lib/openProjectTabs';

/**
 * Barre des affaires ouvertes (5 au plus). `header` : onglets en pastilles dans
 * l'en-tête de l'application (bureau) ; `strip` : bandeau sous l'en-tête (téléphone). Une affaire s'y ajoute dès qu'on
 * ouvre sa fiche ; l'onglet garde l'adresse complète (`?tab=`), donc on rouvre
 * l'affaire là où on l'avait laissée.
 */
export default function ProjectTabsBar({ variant = 'strip' }: { variant?: 'strip' | 'header' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = useOpenProjectTabs();
  const activeId = projectIdFromPath(location.pathname);
  const fullPath = location.pathname + location.search;

  useEffect(() => {
    if (activeId) touchProjectTab(activeId, { path: fullPath });
  }, [activeId, fullPath]);

  if (tabs.length === 0) return null;

  const close = (id: string) => {
    const target = id === activeId ? pathAfterClosing(tabs, id) : null;
    closeProjectTab(id);
    if (target) navigate(target);
  };

  const inHeader = variant === 'header';

  return (
    <nav
      aria-label="Affaires ouvertes"
      className={cn(
        'flex items-center gap-1 overflow-x-auto scroll-fade-x',
        inHeader ? 'min-w-0 flex-1' : 'px-3 sm:px-6 py-1.5 border-b',
      )}
      style={inHeader ? undefined : { borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
    >
      {tabs.map(tab => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex items-center gap-1 shrink-0 max-w-[13rem] rounded-lg border pl-3 pr-1 text-sm',
              active ? 'font-semibold' : 'opacity-80 hover:opacity-100',
            )}
            style={{
              borderColor: active ? 'var(--tblr-text)' : 'var(--tblr-border)',
              background: active ? 'var(--tblr-bg)' : 'transparent',
              color: 'var(--tblr-text)',
            }}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              title={[tab.code, tab.name].filter(Boolean).join(' ')}
              onClick={() => { if (!active) navigate(tab.path); }}
              className="flex items-baseline gap-2 min-w-0 py-1 text-left"
            >
              {tab.code && <span className="font-mono text-[0.6875rem] shrink-0" style={{ color: 'var(--tblr-muted)' }}>{tab.code}</span>}
              <span className="truncate">{tab.name}</span>
            </button>
            <button
              type="button"
              aria-label={`Fermer l'onglet ${tab.name}`}
              onClick={() => close(tab.id)}
              className="p-1 rounded hover:bg-[var(--tblr-surface-2)] shrink-0"
            >
              <IconX size={13} style={{ color: 'var(--tblr-muted)' }} />
            </button>
          </div>
        );
      })}
      <span className="shrink-0 pl-1 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }} aria-hidden="true">
        {tabs.length}/{MAX_OPEN_PROJECT_TABS}
      </span>
    </nav>
  );
}
