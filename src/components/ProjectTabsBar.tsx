import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import {
  MAX_OPEN_PROJECT_TABS, closeProjectTab, pathAfterClosing, projectIdFromPath,
  touchProjectTab, useOpenProjectTabs,
} from '../lib/openProjectTabs';

/**
 * Barre des affaires ouvertes (5 au plus). Une affaire s'y ajoute dès qu'on
 * ouvre sa fiche ; l'onglet garde l'adresse complète (`?tab=`), donc on rouvre
 * l'affaire là où on l'avait laissée.
 */
export default function ProjectTabsBar() {
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

  return (
    <nav
      aria-label="Affaires ouvertes"
      className="flex items-end gap-1 overflow-x-auto px-3 sm:px-6 pt-2 border-b scroll-fade-x"
      style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface)' }}
    >
      {tabs.map(tab => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex items-center gap-1 shrink-0 max-w-[14rem] rounded-t-lg border border-b-0 pl-3 pr-1 text-sm',
              active ? 'font-semibold' : 'opacity-80 hover:opacity-100',
            )}
            style={{
              borderColor: 'var(--tblr-border)',
              background: active ? 'var(--tblr-bg)' : 'transparent',
              color: 'var(--tblr-text)',
              marginBottom: active ? -1 : 0,
            }}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              title={[tab.code, tab.name].filter(Boolean).join(' ')}
              onClick={() => { if (!active) navigate(tab.path); }}
              className="flex items-baseline gap-2 min-w-0 py-1.5 text-left"
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
      <span className="shrink-0 pb-1.5 pl-2 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }} aria-hidden="true">
        {tabs.length}/{MAX_OPEN_PROJECT_TABS}
      </span>
    </nav>
  );
}
