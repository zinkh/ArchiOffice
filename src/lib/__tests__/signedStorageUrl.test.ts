import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));

import { forgetSignedUrls, resolveSignedUrl } from '../signedStorageUrl';

const answer = (ref: string, expiresIn = 3600) => ({ url: `https://signed.example/${ref}`, expiresIn });

beforeEach(() => {
  apiFetch.mockReset();
  forgetSignedUrls();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('resolveSignedUrl', () => {
  it("ne redemande pas l'URL d'une photo déjà résolue", async () => {
    apiFetch.mockImplementation(async (path: string) => answer(path));
    const first = await resolveSignedUrl('ref-a');
    const second = await resolveSignedUrl('ref-a');
    expect(second).toBe(first);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('fusionne les demandes simultanées pour une même référence', async () => {
    apiFetch.mockImplementation(async (path: string) => answer(path));
    const [a, b, c] = await Promise.all([resolveSignedUrl('ref-b'), resolveSignedUrl('ref-b'), resolveSignedUrl('ref-b')]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('redemande une URL quand 80 % de sa durée de vie sont écoulés', async () => {
    apiFetch.mockImplementation(async (path: string) => answer(path, 100));
    await resolveSignedUrl('ref-c');
    vi.advanceTimersByTime(79_000);
    await resolveSignedUrl('ref-c');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await resolveSignedUrl('ref-c');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('ne garde pas en mémoire un échec : la demande suivante réessaie', async () => {
    apiFetch.mockRejectedValueOnce(new Error('réseau'));
    await expect(resolveSignedUrl('ref-d')).rejects.toThrow('réseau');
    apiFetch.mockImplementation(async (path: string) => answer(path));
    await expect(resolveSignedUrl('ref-d')).resolves.toContain('signed.example');
  });

  it('limite à quatre le nombre de résolutions en parallèle', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    apiFetch.mockImplementation((path: string) => new Promise(resolve => {
      active++;
      peak = Math.max(peak, active);
      releases.push(() => { active--; resolve(answer(path)); });
    }));
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => resolveSignedUrl(`ref-p${i}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(peak).toBe(4);
    while (releases.length) {
      releases.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    await all;
    expect(peak).toBe(4);
    expect(apiFetch).toHaveBeenCalledTimes(10);
  });

  it('forgetSignedUrls oublie une référence précise', async () => {
    apiFetch.mockImplementation(async (path: string) => answer(path));
    await resolveSignedUrl('ref-e');
    forgetSignedUrls('ref-e');
    await resolveSignedUrl('ref-e');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
