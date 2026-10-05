import { useSyncExternalStore } from 'react';
import { getActiveTenantId } from './activeTenant';

/**
 * Onglets d'affaires ouvertes : on passe d'une opération à l'autre sans perdre
 * l'endroit où l'on était (onglet de la fiche, ouverture d'une pièce...).
 * Plafonné pour ne pas alourdir l'application : au-delà, l'onglet le moins
 * récemment consulté est refermé (jamais celui qu'on vient d'ouvrir).
 */
export const MAX_OPEN_PROJECT_TABS = 5;

export interface OpenProjectTab {
  id: string;
  name: string;
  code?: string;
  /** Adresse complète (chemin + paramètres) à rouvrir : `?tab=` y est conservé. */
  path: string;
  touchedAt: number;
}

export type OpenProjectTabPatch = Partial<Omit<OpenProjectTab, 'id' | 'touchedAt'>>;

const PROJECT_PATH = /^\/projects\/([^/?#]+)\/?$/;

/** Identifiant de l'affaire d'une adresse `/projects/:id`, sinon null. */
export function projectIdFromPath(pathname: string): string | null {
  const m = PROJECT_PATH.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Crée ou met à jour l'onglet d'une affaire. L'ordre des onglets existants ne
 * bouge pas ; `touch` marque l'onglet comme consulté maintenant. Retourne une
 * nouvelle liste (jamais de mutation).
 */
export function upsertTab(
  tabs: OpenProjectTab[],
  id: string,
  patch: OpenProjectTabPatch,
  now: number,
  touch: boolean,
  max: number = MAX_OPEN_PROJECT_TABS,
): OpenProjectTab[] {
  const existing = tabs.find(t => t.id === id);
  if (existing) {
    const next: OpenProjectTab = {
      ...existing,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.code !== undefined ? { code: patch.code } : {}),
      ...(patch.path ? { path: patch.path } : {}),
      touchedAt: touch ? now : existing.touchedAt,
    };
    return tabs.map(t => (t.id === id ? next : t));
  }
  const created: OpenProjectTab = {
    id,
    name: patch.name || 'Affaire',
    code: patch.code,
    path: patch.path || `/projects/${encodeURIComponent(id)}`,
    touchedAt: now,
  };
  let list = [...tabs, created];
  while (list.length > max) {
    const oldest = list.filter(t => t.id !== id).sort((a, b) => a.touchedAt - b.touchedAt)[0];
    if (!oldest) break;
    list = list.filter(t => t.id !== oldest.id);
  }
  return list;
}

export function removeTab(tabs: OpenProjectTab[], id: string): OpenProjectTab[] {
  return tabs.filter(t => t.id !== id);
}

/** Onglet à ouvrir quand on referme celui de l'écran : le voisin, sinon la liste des affaires. */
export function pathAfterClosing(tabs: OpenProjectTab[], closedId: string): string {
  const i = tabs.findIndex(t => t.id === closedId);
  const remaining = removeTab(tabs, closedId);
  if (remaining.length === 0) return '/projects';
  return remaining[Math.min(Math.max(i, 0), remaining.length - 1)].path;
}

// ── Store (un par cabinet, conservé dans le navigateur) ────────────────────

const STORAGE_PREFIX = 'archioffice.openProjectTabs.v1';
const storageKey = () => `${STORAGE_PREFIX}:${getActiveTenantId() ?? 'default'}`;

let tabs: OpenProjectTab[] = [];
let loadedKey: string | null = null;
const listeners = new Set<() => void>();

function isTab(x: any): x is OpenProjectTab {
  return x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.path === 'string' && typeof x.touchedAt === 'number';
}

function ensureLoaded(): void {
  const key = storageKey();
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    tabs = Array.isArray(parsed) ? parsed.filter(isTab).slice(0, MAX_OPEN_PROJECT_TABS) : [];
  } catch {
    tabs = [];
  }
}

function commit(next: OpenProjectTab[]): void {
  tabs = next;
  try { localStorage.setItem(storageKey(), JSON.stringify(tabs)); } catch { /* stockage indisponible : les onglets restent en mémoire */ }
  listeners.forEach(l => l());
}

export function getOpenProjectTabs(): OpenProjectTab[] {
  ensureLoaded();
  return tabs;
}

/** À appeler quand l'affaire est affichée : crée l'onglet s'il manque et le marque consulté. */
export function touchProjectTab(id: string, patch: OpenProjectTabPatch = {}): void {
  ensureLoaded();
  const current = tabs.find(t => t.id === id);
  // Rien à écrire si l'onglet est déjà à jour (évite une écriture à chaque rendu).
  if (current && (!patch.path || patch.path === current.path) && (!patch.name || patch.name === current.name) && (patch.code === undefined || patch.code === current.code)) {
    return;
  }
  commit(upsertTab(tabs, id, patch, Date.now(), true));
}

/** Renseigne le nom et le code une fois l'affaire chargée, sans changer l'onglet consulté. */
export function setProjectTabInfo(id: string, info: { name?: string; code?: string }): void {
  ensureLoaded();
  const current = tabs.find(t => t.id === id);
  if (!current) return;
  if ((!info.name || info.name === current.name) && (info.code === undefined || info.code === current.code)) return;
  commit(upsertTab(tabs, id, info, Date.now(), false));
}

export function closeProjectTab(id: string): void {
  ensureLoaded();
  commit(removeTab(tabs, id));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useOpenProjectTabs(): OpenProjectTab[] {
  return useSyncExternalStore(subscribe, getOpenProjectTabs, getOpenProjectTabs);
}
