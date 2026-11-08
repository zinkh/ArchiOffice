// ── Cycle de vie d'un document de l'espace PRO ───────────────────────────────
// Extrait verbatim de ProTab.tsx, où il était écrit en dur pour le seul DPGF :
// chargement depuis l'API avec repli sur localStorage, sauvegarde débouncée à
// deux secondes, garde anti-sauvegarde à vide.
//
// Le BPU est un SECOND document qui a besoin exactement de la même chose.
// Recopier l'effet une deuxième fois donnerait deux implémentations
// d'autosauvegarde subtilement divergentes ; il est donc factorisé ici.
//
// Garde-fous contre la perte de saisie (voir aussi src/lib/proDraft.ts) :
//  - un enregistrement a un DÉLAI MAXIMUM : une requête qui ne répond jamais finit en erreur au lieu de
//    laisser l'indicateur tourner indéfiniment pendant que la saisie n'existe que dans le navigateur ;
//  - un échec relance un nouvel essai tout seul (5 s, 10 s, 20 s, puis 30 s), tant que la saisie n'est
//    pas partie ;
//  - la saisie non enregistrée est gardée dans un BROUILLON local, jamais écrasé par un chargement : au
//    rechargement, il est proposé à la personne (`recovered`) au lieu d'être perdu ;
//  - fermer ou recharger l'onglet avec une saisie non envoyée demande confirmation, masquer l'onglet
//    ou quitter l'écran envoie la saisie tout de suite ;
//  - un INSTANTANÉ du document affiché est figé toutes les 10 minutes (`snapshot`), qu'il soit ou non
//    enregistré : même une saisie que l'enregistrement n'a pas pu envoyer finit dans l'historique.
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { INTERVALLE_INSTANTANE_MS } from '../lib/instantanes';
import {
  cleBrouillon, cleRecupere, delaiNouvelEssai, ecrireBrouillon, effacerBrouillon, lireBrouillon, rapprocherBrouillons,
  type Brouillon,
} from '../lib/proDraft';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/** Code du serveur : le document stocké a changé depuis sa lecture, rien n'a été écrit. */
export const DOC_STALE_CODE = 'DOC_STALE';
const isStale = (e: unknown): boolean => (e as { code?: string } | null)?.code === DOC_STALE_CODE;

/** Code d'une erreur d'enregistrement : le serveur n'a pas répondu dans le délai. */
export const SAVE_TIMEOUT_CODE = 'SAVE_TIMEOUT';
/** Délai maximum d'un enregistrement, requête comprise (jeton, réseau, serveur). */
export const DELAI_ENREGISTREMENT_MS = 30_000;

export interface SaveFailure {
  code?: string;
  status?: number;
  /** Nom de l'erreur (`TimeoutError`, `AbortError` quand la requête a été coupée). */
  name?: string;
  message: string;
}

export interface AutosavedDoc<T> {
  doc: T | null;
  setDoc: (doc: T) => void;
  loading: boolean;
  saveStatus: SaveStatus;
  /** Saisie pas encore enregistrée sur le serveur (y compris pendant l'envoi). */
  dirty: boolean;
  /** Depuis quand l'enregistrement échoue (ms depuis 1970), sinon null. */
  failingSince: number | null;
  /** Dernier motif d'échec, pour l'afficher. */
  lastError: SaveFailure | null;
  /** Brouillon retrouvé au chargement, différent de la version du serveur : à restaurer ou à mettre de côté. */
  recovered: Brouillon<T> | null;
  /** Reprend le brouillon : la version stockée est d'abord figée, puis la saisie retrouvée est enregistrée. */
  restoreRecovered: () => Promise<void>;
  /** Met le brouillon de côté (figé dans l'historique quand `backupLocal` existe) puis l'oublie. */
  discardRecovered: () => Promise<void>;
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
  /** Délai maximum d'un enregistrement (défaut `DELAI_ENREGISTREMENT_MS`). */
  saveTimeoutMs?: number;
  /** Fige la version LOCALE avant qu'elle ne soit remplacée par la version à jour (sortie 'reload'). */
  backupLocal?: (key: string, doc: T) => Promise<void>;
  /** Fige la version STOCKÉE avant qu'elle ne soit remplacée par la version locale (sortie 'overwrite'). */
  backupRemote?: (key: string) => Promise<void>;
  /** Fige le document affiché dans l'historique (instantané automatique). Sans elle, aucun instantané. */
  snapshot?: (key: string, doc: T) => Promise<void>;
  /** Intervalle des instantanés (défaut `INTERVALLE_INSTANTANE_MS`). */
  snapshotEveryMs?: number;
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

/** Rejette avec `SAVE_TIMEOUT` si la promesse n'est pas réglée à temps (jamais d'attente sans fin). */
function avecDelai<R>(promesse: Promise<R>, ms: number): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const minuteur = setTimeout(() => {
      reject(Object.assign(new Error('Le serveur ne répond pas : enregistrement abandonné.'), { code: SAVE_TIMEOUT_CODE }));
    }, ms);
    promesse.then(
      valeur => { clearTimeout(minuteur); resolve(valeur); },
      erreur => { clearTimeout(minuteur); reject(erreur); },
    );
  });
}

const enEchec = (e: unknown): SaveFailure => {
  const err = e as { code?: string; status?: number; name?: string; message?: string } | null;
  return { code: err?.code, status: err?.status, name: err?.name, message: err?.message ?? String(e) };
};

export function useAutosavedDoc<T>({
  key, load, save, empty, lsKey, enabled = true, debounceMs = 2000, saveTimeoutMs = DELAI_ENREGISTREMENT_MS,
  backupLocal, backupRemote, snapshot, snapshotEveryMs = INTERVALLE_INSTANTANE_MS,
}: UseAutosavedDocOptions<T>): AutosavedDoc<T> {
  const [doc, setDoc] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const [failingSince, setFailingSince] = useState<number | null>(null);
  const [lastError, setLastError] = useState<SaveFailure | null>(null);
  const [recovered, setRecovered] = useState<Brouillon<T> | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // Tant qu'un conflit n'est pas résolu : plus aucun enregistrement automatique (il échouerait à chaque
  // frappe), et le brouillon continue d'être écrit pour que rien ne se perde en quittant la page.
  const conflictRef = useRef(false);
  const enterConflict = () => { conflictRef.current = true; setSaveStatus('conflict'); };

  // JSON du dernier état persisté, pour ne pas sauvegarder à vide.
  const lastSavedJson = useRef<string | null>(null);
  // JSON du dernier état figé en instantané, pour ne pas figer deux fois la même chose.
  const lastSnapshotJson = useRef<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  // Le document courant, pour que saveNow ne dépende pas de l'état capturé.
  const docRef = useRef<T | null>(null);
  docRef.current = doc;
  // La clé du document réellement chargé : entre un changement de clé et la fin du chargement, `doc` est
  // encore celui de l'ancien document et ne doit jamais être écrit sous la nouvelle clé.
  const docKeyRef = useRef<string | null>(null);
  // Les options lues par les écouteurs et nettoyages, qui ne doivent pas capturer une fermeture périmée.
  const optsRef = useRef({ save, lsKey, backupLocal, backupRemote, snapshot, saveTimeoutMs });
  optsRef.current = { save, lsKey, backupLocal, backupRemote, snapshot, saveTimeoutMs };
  const recoveredRef = useRef<Brouillon<T> | null>(null);
  recoveredRef.current = recovered;
  const aDesInstantanes = snapshot !== undefined;

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  const fetchDoc = useCallback(async (): Promise<{ data: T; atteint: boolean }> => {
    const storeKey = lsKey(key);
    try {
      const data = await load(key);
      if (data) {
        lsSave(storeKey, data);
        return { data, atteint: true };
      }
      return { data: lsLoad<T>(storeKey) ?? empty(key), atteint: true };
    } catch { /* API indisponible : on retombe sur le brouillon, puis sur la copie locale */ }
    const brouillon = lireBrouillon<T>(cleBrouillon(storeKey));
    return { data: brouillon?.doc ?? lsLoad<T>(storeKey) ?? empty(key), atteint: false };
  }, [key, load, empty, lsKey]);

  /** Envoie le document ; l'état (enregistrement, échec, brouillon) est tenu ici, une seule fois pour tous les appelants. */
  const persist = useCallback(async (docToSave: T, json: string): Promise<void> => {
    const { save: envoyer, lsKey: cleLocale, saveTimeoutMs: delai } = optsRef.current;
    setSaveStatus('saving');
    try {
      await avecDelai(envoyer(key, docToSave), delai);
    } catch (e) {
      if (isStale(e)) { enterConflict(); throw e; }
      failures.current += 1;
      setFailingSince(prev => prev ?? Date.now());
      setLastError(enEchec(e));
      setSaveStatus('error');
      clearRetry();
      retryTimer.current = setTimeout(() => setRetryTick(n => n + 1), delaiNouvelEssai(failures.current));
      throw e;
    }
    lastSavedJson.current = json;
    failures.current = 0;
    setFailingSince(null);
    setLastError(null);
    lsSave(cleLocale(key), docToSave);
    // Une modification faite pendant l'envoi reste à enregistrer : son brouillon est conservé.
    const courant = docRef.current;
    if (courant === null || JSON.stringify(courant) === json) {
      effacerBrouillon(cleBrouillon(cleLocale(key)));
      setDirty(false);
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2000);
  }, [key]);

  /** Envoie tout de suite une saisie en attente (onglet masqué, changement d'écran) ; l'échec relance les essais. */
  const flush = useCallback((): void => {
    const courant = docRef.current;
    if (!courant || conflictRef.current || docKeyRef.current !== key) return;
    const json = JSON.stringify(courant);
    if (json === lastSavedJson.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    void persist(courant, json).catch(() => { /* l'état d'échec et le nouvel essai sont déjà tenus par persist */ });
  }, [key, persist]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    lastSavedJson.current = null;
    lastSnapshotJson.current = null;
    docKeyRef.current = null;
    conflictRef.current = false;
    failures.current = 0;
    clearRetry();
    setFailingSince(null);
    setLastError(null);
    setDirty(false);
    setRecovered(null);
    fetchDoc().then(async ({ data, atteint }) => {
      if (cancelled) return;
      const serveurJson = JSON.stringify(data);
      if (atteint) {
        // La saisie qu'une session précédente n'a pas pu envoyer : proposée, jamais écrasée.
        const cleLocale = lsKey(key);
        const principal = cleBrouillon(cleLocale);
        const abrite = cleRecupere(cleLocale);
        const { aProposer, ecartes } = rapprocherBrouillons<T>(serveurJson, [lireBrouillon<T>(principal), lireBrouillon<T>(abrite)]);
        // Les plus anciens sont figés dans l'historique ; s'ils ne peuvent pas l'être, rien n'est supprimé.
        let figes = true;
        for (const ancien of ecartes) {
          try {
            if (!optsRef.current.backupLocal) { figes = false; break; }
            await optsRef.current.backupLocal(key, ancien.doc);
          } catch { figes = false; break; }
        }
        if (cancelled) return;
        if (aProposer) {
          if (figes) {
            ecrireBrouillon(abrite, JSON.stringify(aProposer.doc), aProposer.enregistreLe);
            effacerBrouillon(principal);
          }
          setRecovered(aProposer);
        } else {
          effacerBrouillon(principal);
          effacerBrouillon(abrite);
        }
      }
      // Mémoriser l'état chargé pour que l'autosauvegarde ne parte pas aussitôt.
      lastSavedJson.current = serveurJson;
      lastSnapshotJson.current = serveurJson;
      docKeyRef.current = key;
      setDoc(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      // Quitter l'écran ou changer d'affaire : la saisie en attente part tout de suite.
      flush();
    };
    // `flush` change avec `key`/`persist` : le nettoyage doit envoyer sous l'ancienne clé, celle de ce rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, fetchDoc]);

  useEffect(() => {
    if (!enabled || !doc || docKeyRef.current !== key) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedJson.current) { setDirty(false); return; } // rien n'a changé
    setDirty(true);

    // Brouillon immédiat : rien n'est perdu si l'on quitte ou recharge la page.
    ecrireBrouillon(cleBrouillon(lsKey(key)), json);
    if (conflictRef.current) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void persist(doc, json).catch(() => { /* échec tenu par persist, nouvel essai programmé */ });
    }, debounceMs);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [doc, key, enabled, lsKey, debounceMs, persist, retryTick]);

  // Instantané du document affiché toutes les 10 minutes, seulement s'il a changé depuis le dernier.
  // Il fige l'état de l'ÉCRAN, enregistré ou non : c'est ce qui sauve une saisie que l'enregistrement
  // n'a pas réussi à envoyer. Un échec est sans conséquence, le prochain passage réessaie.
  useEffect(() => {
    if (!enabled || !aDesInstantanes) return;
    const minuteur = setInterval(() => {
      const courant = docRef.current;
      const figer = optsRef.current.snapshot;
      if (!courant || !figer || docKeyRef.current !== key) return;
      const json = JSON.stringify(courant);
      if (json === lastSnapshotJson.current) return;
      figer(key, courant).then(
        () => { lastSnapshotJson.current = json; },
        () => { /* réessayé au prochain passage */ },
      );
    }, snapshotEveryMs);
    return () => clearInterval(minuteur);
  }, [enabled, aDesInstantanes, key, snapshotEveryMs]);

  // Fermer ou recharger l'onglet avec une saisie non envoyée : confirmation du navigateur.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Requis par Chrome et Electron pour afficher la boîte de confirmation.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Onglet masqué (autre onglet, téléphone en veille) ou page quittée : la saisie part tout de suite.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  useEffect(() => () => { clearRetry(); }, []);

  const saveNow = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    // Pas de nouvelle tentative pendant un conflit : le serveur le refuserait de la même façon.
    if (conflictRef.current) throw Object.assign(new Error('Conflit d\'enregistrement non résolu'), { code: DOC_STALE_CODE });
    // L'appelant (validerInstantane, etc.) doit pouvoir détecter l'échec : `persist` relève l'exception.
    await persist(current, JSON.stringify(current));
  }, [persist]);

  const reload = useCallback(async () => {
    const { data } = await fetchDoc();
    lastSavedJson.current = JSON.stringify(data);
    docKeyRef.current = key;
    // La version du serveur remplace l'état local : le brouillon ne décrit plus rien.
    effacerBrouillon(cleBrouillon(lsKey(key)));
    setDoc(data);
  }, [fetchDoc, key, lsKey]);

  const restoreRecovered = useCallback(async () => {
    const reprise = recoveredRef.current;
    if (!reprise) return;
    // La version stockée est figée d'abord : si cela échoue, l'exception remonte et rien ne change.
    await optsRef.current.backupRemote?.(key);
    effacerBrouillon(cleRecupere(lsKey(key)));
    setRecovered(null);
    setDoc(reprise.doc);
  }, [key, lsKey]);

  const discardRecovered = useCallback(async () => {
    const abandon = recoveredRef.current;
    if (!abandon) return;
    await optsRef.current.backupLocal?.(key, abandon.doc);
    effacerBrouillon(cleRecupere(lsKey(key)));
    setRecovered(null);
  }, [key, lsKey]);

  const resolveConflict = useCallback(async (choice: 'reload' | 'overwrite') => {
    const mine = docRef.current;
    if (!conflictRef.current || !mine) return;
    if (choice === 'reload') {
      // La mise de côté d'abord : si elle échoue, l'exception remonte, le conflit reste et ma version aussi.
      await optsRef.current.backupLocal?.(key, mine);
      conflictRef.current = false;
      await reload();
      setSaveStatus('idle');
      return;
    }
    await optsRef.current.backupRemote?.(key);
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
  }, [key, load, reload, saveNow]);

  return {
    doc, setDoc, loading, saveStatus, dirty, failingSince, lastError, recovered,
    restoreRecovered, discardRecovered, saveNow, reload, resolveConflict,
  };
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
