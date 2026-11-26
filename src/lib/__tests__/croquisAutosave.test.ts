import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CroquisScene } from '../../types/croquis';
import { AUTOSAVE_DELAY_MS, createAutosaver, type AutosaveState, type AutosaveStatus } from '../croquis/autosave';

const rect = (id: string) => ({
  id, type: 'rect' as const, x1: 0, y1: 0, x2: 100, y2: 60, k: 1, seed: 7, rough: true, color: '#141414', sw: 2.2,
  fill: 'none' as const, angle: 45, gap: 7,
});
const state = (n: number, bgOpacity = 0.35): AutosaveState => ({
  scene: { version: 1, elements: Array.from({ length: n }, (_, i) => rect(`e${i}`)) } as CroquisScene,
  bgOpacity,
});

/** Un envoi dont on décide quand il se termine. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(options: { resendInitial?: boolean; persist?: (s: AutosaveState) => Promise<{ queued: boolean }> } = {}) {
  const statuses: AutosaveStatus[] = [];
  const persisted: AutosaveState[] = [];
  const persist = vi.fn(options.persist ?? (async () => ({ queued: false })));
  const saver = createAutosaver(state(0), {
    persist,
    onStatus: (s) => statuses.push(s),
    onPersisted: (s) => persisted.push(s),
  }, { resendInitial: options.resendInitial });
  return { saver, persist, statuses, persisted };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('enregistrement automatique', () => {
  it('attend une pause du dessin et n\'envoie qu\'une fois, avec le dernier état', async () => {
    const { saver, persist } = setup();
    saver.update(state(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    saver.update(state(2));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    saver.update(state(3));
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].scene.elements).toHaveLength(3);
  });

  it('n\'envoie rien quand l\'état est revenu à ce que le serveur connaît', async () => {
    const { saver, persist } = setup();
    saver.update(state(0));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(persist).not.toHaveBeenCalled();
  });

  it('renvoie l\'état initial quand il vient d\'un brouillon jamais parti', async () => {
    const { saver, persist } = setup({ resendInitial: true });
    await saver.flush();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('annonce ses étapes : en attente, enregistrement, enregistré', async () => {
    const { saver, statuses } = setup();
    saver.update(state(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  it('dit « en file » quand l\'écriture est gardée sur l\'appareil, et prévient que l\'état est en lieu sûr', async () => {
    const { saver, statuses, persisted } = setup({ persist: async () => ({ queued: true }) });
    saver.update(state(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(statuses.at(-1)).toBe('queued');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].scene.elements).toHaveLength(1);
  });

  it('enregistre tout de suite à la demande, sans attendre la pause', async () => {
    const { saver, persist } = setup();
    saver.update(state(1));
    await saver.flush();
    expect(persist).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('un changement d\'opacité du fond suffit à déclencher l\'envoi', async () => {
    const { saver, persist } = setup();
    saver.update(state(0, 0.6));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].bgOpacity).toBe(0.6);
  });
});

describe('un seul envoi à la fois', () => {
  it('renvoie ce qui a changé pendant l\'envoi, sans jamais en lancer deux en parallèle', async () => {
    const first = deferred<{ queued: boolean }>();
    let running = 0;
    let maxRunning = 0;
    const persist = vi.fn(async (s: AutosaveState) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      try {
        return s.scene.elements.length === 1 ? await first.promise : { queued: false };
      } finally {
        running -= 1;
      }
    });
    const saver = createAutosaver(state(0), { persist, onStatus: () => undefined });

    saver.update(state(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(persist).toHaveBeenCalledTimes(1);

    saver.update(state(2));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(persist).toHaveBeenCalledTimes(1);

    first.resolve({ queued: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0].scene.elements).toHaveLength(2);
    expect(maxRunning).toBe(1);
  });

  it('le flush attend l\'envoi en cours puis envoie le reste', async () => {
    const first = deferred<{ queued: boolean }>();
    const persist = vi.fn(async (s: AutosaveState) => (s.scene.elements.length === 1 ? first.promise : { queued: false }));
    const saver = createAutosaver(state(0), { persist, onStatus: () => undefined });
    saver.update(state(1));
    const firstFlush = saver.flush();
    saver.update(state(2));
    const secondFlush = saver.flush();
    first.resolve({ queued: false });
    await Promise.all([firstFlush, secondFlush]);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(saver.current().scene.elements).toHaveLength(2);
  });

  it('un état écrasé côté serveur est renvoyé après markUnsaved', async () => {
    const { saver, persist } = setup();
    saver.update(state(1));
    await saver.flush();
    expect(persist).toHaveBeenCalledTimes(1);

    await saver.flush();
    expect(persist).toHaveBeenCalledTimes(1);
    saver.markUnsaved();
    await saver.flush();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0].scene.elements).toHaveLength(1);
  });
});

describe('erreurs', () => {
  it('passe en erreur sans boucler, et réessaie à la modification suivante', async () => {
    let calls = 0;
    const { saver, statuses, persisted } = setup({
      persist: async () => {
        calls += 1;
        if (calls === 1) throw new Error('409');
        return { queued: false };
      },
    });
    saver.update(state(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 5);
    expect(calls).toBe(1);
    expect(statuses.at(-1)).toBe('error');
    expect(persisted).toHaveLength(0);

    saver.update(state(2));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls).toBe(2);
    expect(statuses.at(-1)).toBe('saved');
    expect(persisted).toHaveLength(1);
  });

  it('un flush explicite après une erreur réessaie', async () => {
    let calls = 0;
    const { saver } = setup({
      persist: async () => {
        calls += 1;
        if (calls === 1) throw new Error('réseau');
        return { queued: true };
      },
    });
    saver.update(state(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls).toBe(1);
    await saver.flush();
    expect(calls).toBe(2);
  });
});

describe('dispose', () => {
  it('annule l\'enregistrement différé et ignore les modifications suivantes', async () => {
    const { saver, persist } = setup();
    saver.update(state(1));
    saver.dispose();
    saver.update(state(2));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(persist).not.toHaveBeenCalled();
  });
});
