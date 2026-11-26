// @vitest-environment jsdom
// Conflit d'enregistrement de l'éditeur PRO : quand le serveur répond DOC_STALE (le document a changé
// ailleurs depuis sa lecture), le hook n'écrase rien, ne réessaie pas à chaque frappe, et propose deux
// sorties qui conservent toujours la version perdue de côté (instantané restaurable).
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutosavedDoc, type AutosavedDoc } from '../src/hooks/useAutosavedDoc';

vi.mock('../src/lib/api', () => ({ apiFetch: vi.fn() }));

type Doc = { titre: string };
const emptyDoc = (): Doc => ({ titre: 'vide' });
const lsKeyOf = (k: string) => `test_${k}`;
const stale = () => Object.assign(new Error('Document modifié ailleurs'), { status: 409, code: 'DOC_STALE' });

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* sans stockage */ }
});

async function mount(options: Partial<Parameters<typeof useAutosavedDoc<Doc>>[0]> & { save: (k: string, d: Doc) => Promise<void> }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let api!: AutosavedDoc<Doc>;
  const load = options.load ?? (async () => ({ titre: 'stocké' }));
  function Harness() {
    // `empty` et `lsKey` sont stables (niveau du module), comme dans ProTab : le hook les a dans ses dépendances.
    api = useAutosavedDoc<Doc>({ key: 'p', load, empty: emptyDoc, lsKey: lsKeyOf, debounceMs: 1, ...options });
    return null;
  }
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(Harness)); });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  return () => api;
}

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

describe('useAutosavedDoc : conflit', () => {
  it('passe en conflit sur DOC_STALE et ne réessaie pas à chaque frappe', async () => {
    const save = vi.fn().mockRejectedValue(stale());
    const get = await mount({ save });
    await act(async () => { get().setDoc({ titre: 'ma version' }); });
    await settle();
    expect(get().saveStatus).toBe('conflict');
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { get().setDoc({ titre: 'ma version, suite' }); });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(get().doc).toEqual({ titre: 'ma version, suite' }); // la saisie reste à l'écran
  });

  it('un enregistrement demandé pendant un conflit est refusé sans appeler le serveur', async () => {
    const save = vi.fn().mockRejectedValue(stale());
    const get = await mount({ save });
    await act(async () => { get().setDoc({ titre: 'ma version' }); });
    await settle();

    await expect(get().saveNow()).rejects.toMatchObject({ code: 'DOC_STALE' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('une autre erreur reste une erreur simple, sans conflit', async () => {
    const save = vi.fn().mockRejectedValue(new Error('réseau'));
    const get = await mount({ save });
    await act(async () => { get().setDoc({ titre: 'ma version' }); });
    await settle();
    expect(get().saveStatus).toBe('error');
  });

  it('« charger la version à jour » fige d\'abord ma version, puis recharge', async () => {
    const ordre: string[] = [];
    const save = vi.fn().mockRejectedValueOnce(stale()).mockImplementation(async () => { ordre.push('save'); });
    const load = vi.fn(async () => { ordre.push('load'); return { titre: 'version à jour' }; });
    const backupLocal = vi.fn(async () => { ordre.push('backupLocal'); });
    const get = await mount({ save, load, backupLocal });
    await act(async () => { get().setDoc({ titre: 'ma version' }); });
    await settle();
    expect(get().saveStatus).toBe('conflict');

    ordre.length = 0;
    await act(async () => { await get().resolveConflict('reload'); });
    expect(backupLocal).toHaveBeenCalledWith('p', { titre: 'ma version' });
    expect(ordre).toEqual(['backupLocal', 'load']);
    expect(get().doc).toEqual({ titre: 'version à jour' });
    expect(get().saveStatus).not.toBe('conflict');

    // L'enregistrement automatique repart après la résolution.
    await act(async () => { get().setDoc({ titre: 'nouvelle saisie' }); });
    await settle();
    expect(ordre).toContain('save');
  });

  it('« enregistrer ma version » fige d\'abord la version stockée, relit la révision, puis enregistre', async () => {
    const ordre: string[] = [];
    const save = vi.fn().mockRejectedValueOnce(stale()).mockImplementation(async () => { ordre.push('save'); });
    const load = vi.fn(async () => { ordre.push('load'); return { titre: 'version à jour' }; });
    const backupRemote = vi.fn(async () => { ordre.push('backupRemote'); });
    const get = await mount({ save, load, backupRemote });
    await act(async () => { get().setDoc({ titre: 'ma version' }); });
    await settle();

    ordre.length = 0;
    await act(async () => { await get().resolveConflict('overwrite'); });
    expect(ordre).toEqual(['backupRemote', 'load', 'save']);
    expect(save).toHaveBeenLastCalledWith('p', { titre: 'ma version' });
    expect(get().doc).toEqual({ titre: 'ma version' });
    expect(get().saveStatus).toBe('saved');
  });

  it('si la mise de côté échoue, le conflit reste et rien n\'est remplacé', async () => {
    const save = vi.fn().mockRejectedValue(stale());
    const backupLocal = vi.fn().mockRejectedValue(new Error('instantané impossible'));
    const load = vi.fn(async () => ({ titre: 'version à jour' }));
    const get = await mount({ save, load, backupLocal });
    await act(async () => { get().setDoc({ titre: 'ma version' }); });
    await settle();
    load.mockClear();

    await act(async () => { await get().resolveConflict('reload').catch(() => undefined); });
    expect(get().saveStatus).toBe('conflict');
    expect(get().doc).toEqual({ titre: 'ma version' });
    expect(load).not.toHaveBeenCalled();
  });
});
