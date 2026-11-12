// Enregistrement automatique d'un croquis : attend une pause du dessin, n'envoie qu'UNE écriture à la fois,
// renvoie ce qui a changé pendant l'envoi, et ne boucle jamais sur une erreur. Pur (aucun DOM, aucun
// réseau : l'envoi est injecté), testé avec des minuteurs simulés (src/lib/__tests__/croquisAutosave.test.ts).
// L'envoi réel est `persistCroquisScene` (src/lib/croquisSync.ts), branché par src/hooks/useCroquisSession.ts.
import type { CroquisScene } from '../../types/croquis';
import { serializeScene } from './scene';

export interface AutosaveState {
  scene: CroquisScene;
  bgOpacity: number;
}

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'queued' | 'error';

export interface AutosaveDeps {
  /** Envoie l'état. `queued` : gardé sur l'appareil, il partira au retour du réseau. Lève si le serveur refuse. */
  persist: (state: AutosaveState) => Promise<{ queued: boolean }>;
  onStatus: (status: AutosaveStatus) => void;
  /** Appelé quand l'état est en lieu sûr (envoyé ou en file) : on peut retirer le brouillon local. */
  onPersisted?: (state: AutosaveState) => void;
  /** Pause avant l'enregistrement, en ms (1 s comme les notes de réunion). */
  delayMs?: number;
}

export interface Autosaver {
  /** Une modification : l'état est retenu et l'enregistrement différé. */
  update: (state: AutosaveState) => void;
  /** Enregistre tout de suite ce qui n'est pas encore parti. Résout quand plus rien n'est en cours. */
  flush: () => Promise<void>;
  /** Le serveur ne connaît pas l'état courant (brouillon retrouvé, écriture écrasée) : le prochain `flush` le renvoie. */
  markUnsaved: () => void;
  current: () => AutosaveState;
  dispose: () => void;
}

export const AUTOSAVE_DELAY_MS = 1000;

const keyOf = (state: AutosaveState): string => `${serializeScene(state.scene)}|${state.bgOpacity}`;

export function createAutosaver(initial: AutosaveState, deps: AutosaveDeps, options: { resendInitial?: boolean } = {}): Autosaver {
  const delay = deps.delayMs ?? AUTOSAVE_DELAY_MS;
  let state = initial;
  let persistedKey: string | null = options.resendInitial ? null : keyOf(initial);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let failed = false;
  let disposed = false;

  const changed = (): boolean => keyOf(state) !== persistedKey;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  function flush(): Promise<void> {
    clearTimer();
    if (inflight) return inflight.then(() => (!failed && changed() ? flush() : undefined));
    if (!changed()) return Promise.resolve();
    failed = false;
    const snapshot = state;
    const snapshotKey = keyOf(snapshot);
    deps.onStatus('saving');
    inflight = (async () => {
      try {
        const result = await deps.persist(snapshot);
        persistedKey = snapshotKey;
        deps.onPersisted?.(snapshot);
        deps.onStatus(changed() ? 'pending' : result.queued ? 'queued' : 'saved');
      } catch {
        failed = true;
        deps.onStatus('error');
      } finally {
        inflight = null;
      }
    })();
    return inflight.then(() => (!failed && changed() ? flush() : undefined));
  }

  return {
    update(next) {
      if (disposed) return;
      state = next;
      failed = false;
      deps.onStatus('pending');
      clearTimer();
      timer = setTimeout(() => { void flush(); }, delay);
    },
    flush,
    markUnsaved() {
      persistedKey = null;
    },
    current: () => state,
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
