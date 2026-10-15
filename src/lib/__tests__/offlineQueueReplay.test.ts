import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => new Map<string, any>());

vi.mock('../../db', () => ({
  db: {
    pendingWrites: {
      orderBy: () => ({ toArray: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt) }),
      delete: async (id: string) => { rows.delete(id); },
      update: async (id: string, patch: object) => { Object.assign(rows.get(id), patch); },
      put: async (row: any) => { rows.set(row.id, row); },
    },
  },
}));
vi.mock('../activeTenant', () => ({ getActiveTenantId: () => 'tenant-1' }));

import { replayPendingWrites } from '../offlineQueue';

const entry = (id: string, url: string, createdAt: number, extra: object = {}) => ({
  id, entity: 'observation', method: 'POST', url, kind: 'json', jsonBody: { id },
  status: 'pending', attempts: 0, createdAt, tenantId: 'tenant-1', ...extra,
});

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
    vi.stubGlobal('fetch', (url: string) => (
      url === '/api/hang' ? new Promise(() => {}) : Promise.resolve(new Response(null, { status: 200 }))
    ));

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
    vi.stubGlobal('fetch', () => (hangs ? new Promise(() => {}) : Promise.resolve(new Response(null, { status: 200 }))));

    const first = replayPendingWrites();
    await vi.advanceTimersByTimeAsync(31_000);
    await first;

    hangs = false;
    await replayPendingWrites();
    expect(rows.has('hang')).toBe(false);
  });

  it('s\'arrête après deux délais dépassés d\'affilée (réseau mort)', async () => {
    for (let i = 1; i <= 4; i++) rows.set(`e${i}`, entry(`e${i}`, `/api/e${i}`, i));
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const run = replayPendingWrites();
    await vi.advanceTimersByTimeAsync(61_000);
    await run;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows.size).toBe(4);
  });

  it('marque en échec une photo dont le fichier est illisible, sans bloquer la suite', async () => {
    rows.set('photo', entry('photo', '/api/photo', 1, { kind: 'multipart', blobFieldName: 'photo', blob: new Blob([]) }));
    rows.set('ok', entry('ok', '/api/ok', 2));
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await replayPendingWrites();

    expect(rows.get('photo')).toMatchObject({ status: 'error' });
    expect(rows.get('photo').lastError).toContain('illisible');
    expect(rows.has('ok')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
