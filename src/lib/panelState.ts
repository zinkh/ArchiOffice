import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * État de repli des panneaux (menu latéral, colonnes de listes).
 *
 * Une valeur mémorisée (localStorage, clé `panel:<clé>`) l'emporte sur le
 * défaut ; une valeur posée sans `persist` (repli automatique à l'ouverture
 * d'une réunion sur écran étroit) ne vit qu'en mémoire, pour ne pas écraser le
 * choix que la personne a fait elle-même.
 */
const EVENT = 'archioffice:panel-state';
const PREFIX = 'panel:';
const memory = new Map<string, boolean>();
/** Colonnes de liste actuellement montées → leur défaut, pour Ctrl+Maj+B. */
const listPanels = new Map<string, boolean>();

function stored(key: string): boolean | null {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function read(key: string, fallback: boolean): boolean {
  return memory.get(key) ?? stored(key) ?? fallback;
}

export function setPanelCollapsed(key: string, value: boolean, persist = true) {
  memory.set(key, value);
  if (persist) {
    try { localStorage.setItem(PREFIX + key, value ? '1' : '0'); } catch {}
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function usePanelCollapsed(key: string, defaultCollapsed: boolean, isList = false) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(key, defaultCollapsed),
    () => defaultCollapsed,
  );
  useEffect(() => {
    if (!isList) return;
    listPanels.set(key, defaultCollapsed);
    return () => { listPanels.delete(key); };
  }, [key, isList, defaultCollapsed]);
  const set = useCallback(
    (value: boolean, persist = true) => setPanelCollapsed(key, value, persist),
    [key],
  );
  const toggle = useCallback(
    () => setPanelCollapsed(key, !read(key, defaultCollapsed)),
    [key, defaultCollapsed],
  );
  return { collapsed, set, toggle };
}

/** Ctrl+Maj+B : replie toutes les listes montées, ou les rouvre si toutes sont repliées. */
export function toggleAllLists() {
  const keys = [...listPanels.keys()];
  if (!keys.length) return;
  const anyOpen = keys.some(k => !read(k, listPanels.get(k)!));
  keys.forEach(k => setPanelCollapsed(k, anyOpen));
}

/** Défaut du menu latéral : replié sous 1024 px (iPad portrait). */
export const SIDEBAR_PANEL_KEY = 'sidebar';
export const narrowByDefault = () =>
  typeof window !== 'undefined' && window.innerWidth < 1024;

/** Ctrl+B (menu) et Ctrl+Maj+B (listes). Ignoré dans un éditeur de texte riche. */
export function usePanelShortcuts(toggleSidebar: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'b') return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) toggleAllLists();
      else toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);
}
