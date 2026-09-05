// ── Cycle de vie d'un document de l'espace PRO ───────────────────────────────
// Extrait verbatim de ProTab.tsx, où il était écrit en dur pour le seul DPGF :
// chargement depuis l'API avec repli sur localStorage, sauvegarde débouncée à
// deux secondes, écriture localStorage immédiate, garde anti-sauvegarde à vide.
//
// Le BPU est un SECOND document qui a besoin exactement de la même chose.
// Recopier l'effet une deuxième fois donnerait deux implémentations
// d'autosauvegarde subtilement divergentes ; il est donc factorisé ici.
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosavedDoc<T> {
  doc: T | null;
  setDoc: (doc: T) => void;
  loading: boolean;
  saveStatus: SaveStatus;
  /** Sauvegarde immédiate (bouton du ruban) : annule le débounce en attente. */
  saveNow: () => Promise<void>;
  /** Recharge depuis l'API en écrasant l'état local. */
  reload: () => Promise<void>;
}

export interface UseAutosavedDocOptions<T> {
  /** Identifiant du document — un changement déclenche un rechargement. */
  key: string;
  /** Lecture API. Doit renvoyer null quand le document n'existe pas encore. */
  load: (key: string) => Promise<T | null>;
  /** Écriture API. */
  save: (key: string, doc: T) => Promise<void>;
  /** Document vierge, posé quand l'API ne renvoie rien. */
  empty: (key: string) => T;
  /** Clé de la copie locale, doublure hors ligne. */
  lsKey: (key: string) => string;
  /**
   * Quand faux, rien n'est chargé ni sauvegardé. Sert à ne pas aller chercher
   * le BPU de tous les projets forfaitaires à chaque ouverture de l'espace PRO.
   */
  enabled?: boolean;
  debounceMs?: number;
}

function lsSave<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota */ }
}

function lsLoad<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function useAutosavedDoc<T>({
  key, load, save, empty, lsKey, enabled = true, debounceMs = 2000,
}: UseAutosavedDocOptions<T>): AutosavedDoc<T> {
  const [doc, setDoc] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // JSON du dernier état persisté, pour ne pas sauvegarder à vide.
  const lastSavedJson = useRef<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Le document courant, pour que saveNow ne dépende pas de l'état capturé.
  const docRef = useRef<T | null>(null);
  docRef.current = doc;

  const fetchDoc = useCallback(async (): Promise<T> => {
    const storeKey = lsKey(key);
    try {
      const data = await load(key);
      if (data) {
        lsSave(storeKey, data);
        return data;
      }
    } catch { /* API indisponible — on retombe sur la copie locale */ }
    return lsLoad<T>(storeKey) ?? empty(key);
  }, [key, load, empty, lsKey]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    lastSavedJson.current = null;
    fetchDoc().then(loaded => {
      if (cancelled) return;
      // Mémoriser l'état chargé pour que l'autosauvegarde ne parte pas aussitôt.
      lastSavedJson.current = JSON.stringify(loaded);
      setDoc(loaded);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [key, enabled, fetchDoc]);

  useEffect(() => {
    if (!enabled || !doc) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedJson.current) return; // rien n'a changé

    // Copie locale immédiate : rien n'est perdu si l'on quitte la page.
    lsSave(lsKey(key), doc);

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await save(key, doc);
        lastSavedJson.current = json;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
      }
    }, debounceMs);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [doc, key, enabled, save, lsKey, debounceMs]);

  const saveNow = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus('saving');
    try {
      await save(key, current);
      lastSavedJson.current = JSON.stringify(current);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    }
  }, [key, save]);

  const reload = useCallback(async () => {
    const loaded = await fetchDoc();
    lastSavedJson.current = JSON.stringify(loaded);
    setDoc(loaded);
  }, [fetchDoc]);

  return { doc, setDoc, loading, saveStatus, saveNow, reload };
}

// ── Accès API des deux documents de l'espace PRO ─────────────────────────────
// apiFetch pose le jeton et remonte le message d'erreur du serveur, là où le
// fetch nu employé jusqu'ici ne fonctionnait que par l'effet de bord de
// l'intercepteur global et avalait la cause des échecs.

export async function loadProDoc<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch (e: any) {
    if (e?.status === 404) return null; // document pas encore créé
    throw e;
  }
}
