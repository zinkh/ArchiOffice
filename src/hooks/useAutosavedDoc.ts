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

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/** Code du serveur : le document stocké a changé depuis sa lecture, rien n'a été écrit. */
export const DOC_STALE_CODE = 'DOC_STALE';
const isStale = (e: unknown): boolean => (e as { code?: string } | null)?.code === DOC_STALE_CODE;

export interface AutosavedDoc<T> {
  doc: T | null;
  setDoc: (doc: T) => void;
  loading: boolean;
  saveStatus: SaveStatus;
  /** Sauvegarde immédiate (bouton du ruban) : annule le débounce en attente. */
  saveNow: () => Promise<void>;
  /** Recharge depuis l'API en écrasant l'état local. */
  reload: () => Promise<void>;
  /**
   * Sortie d'un conflit (`saveStatus === 'conflict'`). Dans les deux cas la version qui perd est
   * d'abord mise de côté ; si cette mise de côté échoue, le conflit reste et rien n'est remplacé.
   *  - 'reload' : fige MA version (`backupLocal`), puis charge la version à jour ;
   *  - 'overwrite' : fige la version STOCKÉE (`backupRemote`), relit la révision, puis enregistre la mienne.
   */
  resolveConflict: (choice: 'reload' | 'overwrite') => Promise<void>;
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
  /** Fige la version LOCALE avant qu'elle ne soit remplacée par la version à jour (sortie 'reload'). */
  backupLocal?: (key: string, doc: T) => Promise<void>;
  /** Fige la version STOCKÉE avant qu'elle ne soit remplacée par la version locale (sortie 'overwrite'). */
  backupRemote?: (key: string) => Promise<void>;
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
  key, load, save, empty, lsKey, enabled = true, debounceMs = 2000, backupLocal, backupRemote,
}: UseAutosavedDocOptions<T>): AutosavedDoc<T> {
  const [doc, setDoc] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // Tant qu'un conflit n'est pas résolu : plus aucun enregistrement automatique (il échouerait à chaque
  // frappe), et la copie locale continue d'être écrite pour que rien ne se perde en quittant la page.
  const conflictRef = useRef(false);
  const enterConflict = () => { conflictRef.current = true; setSaveStatus('conflict'); };

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
    conflictRef.current = false;
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
    if (conflictRef.current) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await save(key, doc);
        lastSavedJson.current = json;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (e) {
        if (isStale(e)) enterConflict(); else setSaveStatus('error');
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
    // Pas de nouvelle tentative pendant un conflit : le serveur le refuserait de la même façon.
    if (conflictRef.current) throw Object.assign(new Error('Conflit d\'enregistrement non résolu'), { code: DOC_STALE_CODE });
    setSaveStatus('saving');
    try {
      await save(key, current);
      lastSavedJson.current = JSON.stringify(current);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      if (isStale(e)) enterConflict(); else setSaveStatus('error');
      // On rel\u00e8ve l'exception pour que les appelants (validerInstantane, etc.)
      // puissent la d\u00e9tecter sans interroger l'\u00e9tat React de fa\u00e7on asynchrone.
      throw e;
    }
  }, [key, save]);

  const reload = useCallback(async () => {
    const loaded = await fetchDoc();
    lastSavedJson.current = JSON.stringify(loaded);
    setDoc(loaded);
  }, [fetchDoc]);

  const resolveConflict = useCallback(async (choice: 'reload' | 'overwrite') => {
    const mine = docRef.current;
    if (!conflictRef.current || !mine) return;
    if (choice === 'reload') {
      // La mise de côté d'abord : si elle échoue, l'exception remonte, le conflit reste et ma version aussi.
      await backupLocal?.(key, mine);
      conflictRef.current = false;
      await reload();
      setSaveStatus('idle');
      return;
    }
    await backupRemote?.(key);
    // Relit la révision courante (effet de bord du chargement) sans toucher à ma version à l'écran.
    await load(key);
    conflictRef.current = false;
    try {
      await saveNow();
    } catch (e) {
      // Un nouvel écrivain est passé entre-temps : le conflit recommence, rien n'a été écrit.
      if (isStale(e)) return;
      throw e;
    }
  }, [key, load, reload, saveNow, backupLocal, backupRemote]);

  return { doc, setDoc, loading, saveStatus, saveNow, reload, resolveConflict };
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
