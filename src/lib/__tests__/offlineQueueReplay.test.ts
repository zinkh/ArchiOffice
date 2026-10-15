import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => new Map<string, any>());

vi.mock('../../db', () => ({
  db: {
    pendingWrites: {
      orderBy: () => ({ toArray: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt) }),
      toArray: async () => [...rows.values()],
      bulkGet: async (ids: string[]) => ids.map(id => rows.get(id)),
      delete: async (id: string) => { rows.delete(id); },
      update: async (id: string, patch: object) => { Object.assign(rows.get(id), patch); },
      put: async (row: any) => { rows.set(row.id, row); },
    },
  },
}));
vi.mock('../activeTenant', () => ({ getActiveTenantId: () => 'tenant-1' }));

import { replayPendingWrites, replayNow, getReplayProgress, subscribeReplayProgress } from '../offlineQueue';

const entry = (id: string, url: string, createdAt: number, extra: object = {}) => ({
  id, entity: 'observation', method: 'POST', url, kind: 'json', jsonBody: { id },
  status: 'pending', attempts: 0, createdAt, tenantId: 'tenant-1', ...extra,
});
const photo = (id: string, createdAt: number, extra: object = {}) => entry(id, `/api/${id}`, createdAt, {
  entity: 'observationPhoto', kind: 'multipart', blob: new Blob(['abc']), blobFieldName: 'photo', ...extra,
});
const ok = () => Promise.resolve(new Response(null, { status: 200 }));

describe('replayPendingWrites', () => {
  beforeEach(() => {
    rows.clear();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', { dispatchEvent: () => true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ne reste pas bloqué par une requête qui ne répond jamais et envoie les suivantes', async () => {
    rows.set('hang', entry('hang', '/api/hang', 1));
    rows.set('ok', entry('ok', '/api/ok', 2));
    vi.stubGlobal('fetch', (url: string) => (url === '/api/hang' ? new Promise(() => {}) : ok()));

    const run = replayPendingWrites();
    await vi.advanceTimersByTimeAsync(31_000);
    await run;

    expect(rows.has('ok')).toBe(false);
    expect(rows.get('hang')).toMatchObject({ status: 'pending', attempts: 1 });
    expect(rows.get('hang').lastError).toContain('délai dépassé');
  });

  it('libère le rejeu après un délai dépassé : un second rejeu peut repartir', async () => {
    rows.set('hang', entry('hang', '/api/hang', 1));
    let hangs = true;
    vi.stubGlobal('fetch', () => (hangs ? new Promise(() => {}) : ok()));

    const first = replayPendingWrites();
    await vi.advanceTimersByTimeAsync(31_000);
    await first;

    hangs = false;
    await replayPendingWrites();
    expect(rows.has('hang')).toBe(false);
  });

  it('une erreur réseau rapide sur la première entrée n\'arrête plus tout : la cause est gardée et la suite part', async () => {
    rows.set('bad', entry('bad', '/api/bad', 1));
    rows.set('ok', entry('ok', '/api/ok', 2));
    vi.stubGlobal('fetch', (url: string) => (url === '/api/bad' ? Promise.reject(new TypeError('Load failed')) : ok()));

    await replayPendingWrites();

    expect(rows.has('ok')).toBe(false);
    expect(rows.get('bad')).toMatchObject({ status: 'pending', attempts: 1 });
    expect(rows.get('bad').lastError).toContain('Load failed');
  });

  it('un 502 sur une entrée est consigné avec sa cause et ne bloque pas les autres', async () => {
    rows.set('bad', entry('bad', '/api/bad', 1));
    rows.set('ok', entry('ok', '/api/ok', 2));
    vi.stubGlobal('fetch', (url: string) => (url === '/api/bad' ? Promise.resolve(new Response('gateway', { status: 502 })) : ok()));

    await replayPendingWrites();

    expect(rows.has('ok')).toBe(false);
    expect(rows.get('bad').lastError).toContain('HTTP 502');
    expect(rows.get('bad').status).toBe('pending');
  });

  it('un refus applicatif (400) passe l\'entrée en échec visible sans bloquer la suite', async () => {
    rows.set('bad', entry('bad', '/api/bad', 1));
    rows.set('ok', entry('ok', '/api/ok', 2));
    vi.stubGlobal('fetch', (url: string) => (url === '/api/bad'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Texte requis' }), { status: 400, headers: { 'content-type': 'application/json' } }))
      : ok()));

    await replayPendingWrites();

    expect(rows.has('ok')).toBe(false);
    expect(rows.get('bad')).toMatchObject({ status: 'error', lastError: 'Texte requis' });
  });

  it('s\'arrête après quatre échecs réseau d\'affilée (réseau mort)', async () => {
    for (let i = 1; i <= 6; i++) rows.set(`e${i}`, entry(`e${i}`, `/api/e${i}`, i));
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Load failed')));
    vi.stubGlobal('fetch', fetchMock);

    await replayPendingWrites();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(rows.size).toBe(6);
    expect(getReplayProgress()).toMatchObject({ running: false, stopReason: 'network', failed: 4, sent: 0 });
  });

  it('envoie les saisies avant les photos, et les photos les moins essayées d\'abord', async () => {
    rows.set('photo-bad', photo('photo-bad', 1, { attempts: 5 }));
    rows.set('photo-new', photo('photo-new', 2));
    rows.set('json-late', entry('json-late', '/api/json-late', 3));
    const order: string[] = [];
    vi.stubGlobal('fetch', (url: string) => { order.push(url); return ok(); });

    await replayPendingWrites();

    expect(order).toEqual(['/api/json-late', '/api/photo-new', '/api/photo-bad']);
  });

  it('marque en échec une photo dont le fichier est illisible, sans bloquer la suite', async () => {
    rows.set('photo', photo('photo', 1, { blob: new Blob([]) }));
    rows.set('ok', entry('ok', '/api/ok', 2));
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);

    await replayPendingWrites();

    expect(rows.get('photo')).toMatchObject({ status: 'error' });
    expect(rows.get('photo').lastError).toContain('illisible');
    expect(rows.has('ok')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expose l\'avancement : entrée en cours, compteurs, fin de passage', async () => {
    rows.set('a', entry('a', '/api/a', 1));
    rows.set('b', entry('b', '/api/b', 2));
    const seen: { current: string | null; processed: number }[] = [];
    const unsubscribe = subscribeReplayProgress(() => {
      const p = getReplayProgress();
      seen.push({ current: p.currentId, processed: p.processed });
    });
    vi.stubGlobal('fetch', ok);

    const final = await replayPendingWrites();
    unsubscribe();

    expect(final).toMatchObject({ running: false, total: 2, processed: 2, sent: 2, failed: 0, stopReason: null });
    expect(final.finishedAt).not.toBeNull();
    expect(seen.some(s => s.current === 'a')).toBe(true);
    expect(seen.some(s => s.current === 'b')).toBe(true);
  });

  it('n\'envoie rien hors ligne et le dit', async () => {
    rows.set('a', entry('a', '/api/a', 1));
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);

    await replayPendingWrites();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows.has('a')).toBe(true);
  });

  it('replayNow attend le passage en cours puis rejoue ce qui est arrivé entre-temps', async () => {
    rows.set('slow', entry('slow', '/api/slow', 1));
    let release: () => void = () => {};
    vi.stubGlobal('fetch', (url: string) => (url === '/api/slow' ? new Promise<Response>(resolve => { release = () => resolve(new Response(null, { status: 200 })); }) : ok()));

    const first = replayPendingWrites();
    await vi.advanceTimersByTimeAsync(10);
    rows.set('late', entry('late', '/api/late', 2));
    const waiting = replayNow();
    release();
    await first;
    const final = await waiting;

    expect(rows.size).toBe(0);
    expect(final.sent).toBe(1);
  });
});
