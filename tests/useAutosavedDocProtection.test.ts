// @vitest-environment jsdom
// Garde-fous de l'enregistrement du CCTP / DPGF / BPU contre la perte de saisie : brouillon retrouvé au
// rechargement (jamais écrasé), nouvel essai après un échec, délai maximum d'un enregistrement, confirmation à
// la fermeture, instantané périodique, et saisie en attente jamais écrite sous le mauvais document.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutosavedDoc, type AutosavedDoc } from '../src/hooks/useAutosavedDoc';

vi.mock('../src/lib/api', () => ({ apiFetch: vi.fn() }));
const reglages = vi.hoisted(() => ({ delaiEssai: 400 }));
vi.mock('../src/lib/proDraft', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/proDraft')>()),
  delaiNouvelEssai: () => reglages.delaiEssai,
}));

type Doc = { titre: string };
const emptyDoc = (): Doc => ({ titre: 'vide' });
const lsKeyOf = (k: string) => `test_${k}`;
const BROUILLON = 'test_p:brouillon';
const RECUPERE = 'test_p:recupere';
const jamais = () => new Promise<void>(() => { /* ne répond jamais */ });

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  reglages.delaiEssai = 400;
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* sans stockage */ }
});

const attendre = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const poser = (cle: string, doc: Doc, enregistreLe = 1_794_137_402_475) => localStorage.setItem(cle, JSON.stringify({ enregistreLe, doc }));
const lire = (cle: string) => { const brut = localStorage.getItem(cle); return brut ? JSON.parse(brut) : null; };

async function mount(options: Partial<Parameters<typeof useAutosavedDoc<Doc>>[0]> & { save: (k: string, d: Doc) => Promise<void> }, cle = 'p') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let api!: AutosavedDoc<Doc>;
  const load = options.load ?? (async (k: string) => ({ titre: k === 'p' ? 'stocké' : `stocké ${k}` }));
  function Harness({ docKey }: { docKey: string }) {
    // `empty` et `lsKey` sont stables (niveau du module), comme dans ProTab : le hook les a dans ses dépendances.
    api = useAutosavedDoc<Doc>({ load, empty: emptyDoc, lsKey: lsKeyOf, debounceMs: 1, ...options, key: docKey });
    return null;
  }
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(Harness, { docKey: cle })); });
  await attendre(10);
  return {
    get: () => api,
    changerDeDocument: (autre: string) => act(async () => { root.render(React.createElement(Harness, { docKey: autre })); }),
  };
}

describe('brouillon retrouvé au rechargement', () => {
  it('propose la saisie d\'une session précédente au lieu de l\'écraser par la version du serveur', async () => {
    poser(BROUILLON, { titre: 'ma saisie perdue' });
    const save = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save });

    expect(get().doc).toEqual({ titre: 'stocké' });
    expect(get().recovered?.doc).toEqual({ titre: 'ma saisie perdue' });
    expect(get().recovered?.enregistreLe).toBe(1_794_137_402_475);
    expect(save).not.toHaveBeenCalled();
    // Mise à l'abri : l'emplacement courant est libre pour la prochaine saisie.
    expect(localStorage.getItem(BROUILLON)).toBeNull();
    expect(lire(RECUPERE).doc).toEqual({ titre: 'ma saisie perdue' });
  });

  it('ignore un brouillon identique à la version du serveur', async () => {
    poser(BROUILLON, { titre: 'stocké' });
    const { get } = await mount({ save: vi.fn().mockResolvedValue(undefined) });
    expect(get().recovered).toBeNull();
    expect(localStorage.getItem(BROUILLON)).toBeNull();
    expect(localStorage.getItem(RECUPERE)).toBeNull();
  });

  it('une première frappe ne détruit pas le brouillon retrouvé', async () => {
    poser(BROUILLON, { titre: 'ma saisie perdue' });
    const { get } = await mount({ save: jamais });

    await act(async () => { get().setDoc({ titre: 'nouvelle saisie' }); });
    expect(lire(BROUILLON).doc).toEqual({ titre: 'nouvelle saisie' });
    expect(lire(RECUPERE).doc).toEqual({ titre: 'ma saisie perdue' });
    expect(get().recovered?.doc).toEqual({ titre: 'ma saisie perdue' });
  });

  it('reprendre fige d\'abord la version stockée puis enregistre la saisie retrouvée', async () => {
    poser(BROUILLON, { titre: 'ma saisie perdue' });
    const backupRemote = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save, backupRemote });

    await act(async () => { await get().restoreRecovered(); });
    await attendre(30);
    expect(backupRemote).toHaveBeenCalledWith('p');
    expect(get().recovered).toBeNull();
    expect(get().doc).toEqual({ titre: 'ma saisie perdue' });
    expect(save).toHaveBeenCalledWith('p', { titre: 'ma saisie perdue' });
    expect(localStorage.getItem(RECUPERE)).toBeNull();
  });

  it('reprendre échoue sans rien changer si la version stockée ne peut pas être figée', async () => {
    poser(BROUILLON, { titre: 'ma saisie perdue' });
    const backupRemote = vi.fn().mockRejectedValue(new Error('historique indisponible'));
    const save = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save, backupRemote });

    await expect(act(async () => { await get().restoreRecovered(); })).rejects.toThrow('historique indisponible');
    await attendre(30);
    expect(get().recovered?.doc).toEqual({ titre: 'ma saisie perdue' });
    expect(get().doc).toEqual({ titre: 'stocké' });
    expect(save).not.toHaveBeenCalled();
    expect(lire(RECUPERE).doc).toEqual({ titre: 'ma saisie perdue' });
  });

  it('mettre de côté fige la saisie dans l\'historique puis l\'oublie', async () => {
    poser(BROUILLON, { titre: 'ma saisie perdue' });
    const backupLocal = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save: vi.fn().mockResolvedValue(undefined), backupLocal });

    await act(async () => { await get().discardRecovered(); });
    expect(backupLocal).toHaveBeenCalledWith('p', { titre: 'ma saisie perdue' });
    expect(get().recovered).toBeNull();
    expect(localStorage.getItem(RECUPERE)).toBeNull();
  });
});

describe('échec et délai d\'enregistrement', () => {
  it('un échec relance un nouvel essai tout seul, puis le brouillon est effacé', async () => {
    reglages.delaiEssai = 150;
    const save = vi.fn().mockRejectedValueOnce(new Error('réseau')).mockResolvedValue(undefined);
    const { get } = await mount({ save });

    await act(async () => { get().setDoc({ titre: 'ma saisie' }); });
    await attendre(40);
    expect(get().saveStatus).toBe('error');
    expect(get().failingSince).not.toBeNull();
    expect(get().lastError?.message).toBe('réseau');
    expect(get().dirty).toBe(true);
    expect(lire(BROUILLON).doc).toEqual({ titre: 'ma saisie' });

    // Dans `act`, React garde les mises à jour jusqu'à la fin de l'attente : l'échéance du nouvel essai, puis
    // l'envoi qu'elle déclenche, se laissent attendre en deux temps.
    await attendre(250);
    await attendre(60);
    expect(save).toHaveBeenCalledTimes(2);
    expect(['saved', 'idle']).toContain(get().saveStatus);
    expect(get().failingSince).toBeNull();
    expect(get().lastError).toBeNull();
    expect(get().dirty).toBe(false);
    expect(localStorage.getItem(BROUILLON)).toBeNull();
  });

  it('un enregistrement qui ne répond jamais est abandonné au délai au lieu de tourner sans fin', async () => {
    const save = vi.fn(jamais);
    const { get } = await mount({ save, saveTimeoutMs: 60 });

    await act(async () => { get().setDoc({ titre: 'ma saisie' }); });
    await attendre(20);
    expect(get().saveStatus).toBe('saving');

    await attendre(120);
    expect(get().saveStatus).toBe('error');
    expect(get().lastError?.code).toBe('SAVE_TIMEOUT');
    expect(get().dirty).toBe(true);
    expect(lire(BROUILLON).doc).toEqual({ titre: 'ma saisie' });
  });
});

describe('fermeture de la page', () => {
  const beforeUnload = () => {
    const evenement = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evenement);
    return evenement.defaultPrevented;
  };

  it('demande confirmation tant que la saisie n\'est pas partie', async () => {
    const { get } = await mount({ save: jamais });
    expect(beforeUnload()).toBe(false);
    await act(async () => { get().setDoc({ titre: 'ma saisie' }); });
    expect(beforeUnload()).toBe(true);
  });

  it('ne demande plus rien une fois la saisie enregistrée', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save });
    await act(async () => { get().setDoc({ titre: 'ma saisie' }); });
    await attendre(40);
    expect(save).toHaveBeenCalledTimes(1);
    expect(get().dirty).toBe(false);
    expect(beforeUnload()).toBe(false);
  });
});

describe('instantané périodique', () => {
  it('fige le document affiché à chaque intervalle, seulement s\'il a changé', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save: vi.fn().mockResolvedValue(undefined), snapshot, snapshotEveryMs: 60 });

    await attendre(150);
    expect(snapshot).not.toHaveBeenCalled(); // rien n'a changé depuis le chargement

    await act(async () => { get().setDoc({ titre: 'v2' }); });
    await attendre(150);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith('p', { titre: 'v2' });

    await attendre(150);
    expect(snapshot).toHaveBeenCalledTimes(1); // pas deux fois le même état

    await act(async () => { get().setDoc({ titre: 'v3' }); });
    await attendre(150);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(snapshot).toHaveBeenLastCalledWith('p', { titre: 'v3' });
  });

  it('fige même une saisie que l\'enregistrement n\'a pas pu envoyer', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined);
    const { get } = await mount({ save: vi.fn().mockRejectedValue(new Error('réseau')), snapshot, snapshotEveryMs: 60 });
    await act(async () => { get().setDoc({ titre: 'saisie non enregistrée' }); });
    await attendre(120);
    expect(snapshot).toHaveBeenCalledWith('p', { titre: 'saisie non enregistrée' });
  });

  it('réessaie au passage suivant quand l\'instantané échoue', async () => {
    const snapshot = vi.fn().mockRejectedValueOnce(new Error('indisponible')).mockResolvedValue(undefined);
    const { get } = await mount({ save: vi.fn().mockResolvedValue(undefined), snapshot, snapshotEveryMs: 60 });
    await act(async () => { get().setDoc({ titre: 'v2' }); });
    await attendre(200);
    expect(snapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    const appels = snapshot.mock.calls.length;
    await attendre(150);
    expect(snapshot.mock.calls.length).toBe(appels); // une fois réussi, plus rien tant que rien ne change
  });

  it('sans fonction d\'instantané, aucun instantané', async () => {
    const { get } = await mount({ save: vi.fn().mockResolvedValue(undefined), snapshotEveryMs: 30 });
    await act(async () => { get().setDoc({ titre: 'v2' }); });
    await attendre(100);
    expect(get().doc).toEqual({ titre: 'v2' });
  });
});

describe('changement de document', () => {
  it('la saisie en attente part sous l\'ancien document, jamais sous le nouveau', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    // Délai d'autosauvegarde long : seul l'envoi au changement de document peut la faire partir.
    const { get, changerDeDocument } = await mount({ save, debounceMs: 5000 });

    await act(async () => { get().setDoc({ titre: 'saisie de p' }); });
    await changerDeDocument('p2');
    await attendre(60);

    expect(save).toHaveBeenCalledWith('p', { titre: 'saisie de p' });
    expect(save.mock.calls.some(([cle, doc]) => cle === 'p2' && doc.titre === 'saisie de p')).toBe(false);
    expect(get().doc).toEqual({ titre: 'stocké p2' });
  });
});
