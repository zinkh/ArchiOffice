import { describe, it, expect, vi } from 'vitest';
import { loadProjectDetail } from '../projectDetailLoad';

function setup(overrides: Partial<Parameters<typeof loadProjectDetail>[0]> = {}) {
  return { id: 'p1', signal: new AbortController().signal, readCache: vi.fn().mockResolvedValue(null),
    writeCache: vi.fn().mockResolvedValue(undefined), onData: vi.fn(), isOnline: () => true,
    request: vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: { id: 'p1' } }), { status: 200 })), ...overrides };
}
describe('project detail loading and recovery', () => {
  it('settles offline with no cache instead of staying in loading', async () => {
    const args = setup({ isOnline: () => false });
    expect(await loadProjectDetail(args)).toBe('offline');
    expect(args.onData).not.toHaveBeenCalled();
    expect(args.request).not.toHaveBeenCalled();
  });
  it('keeps the cached snapshot when a refresh fails', async () => {
    const snapshot = { project: { id: 'p1', name: 'Cached' } };
    const args = setup({ readCache: vi.fn().mockResolvedValue(snapshot), request: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    expect(await loadProjectDetail(args)).toBe('error');
    expect(args.onData).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(args.writeCache).not.toHaveBeenCalled();
  });
  it.each([[404, 'not-found'], [403, 'forbidden'], [401, 'forbidden'], [503, 'error']] as const)('distinguishes HTTP %s', async (status, state) => {
    const args = setup({ request: vi.fn().mockResolvedValue(new Response(null, { status })) });
    expect(await loadProjectDetail(args)).toBe(state);
    expect(args.onData).not.toHaveBeenCalled();
  });
  it('loads online despite a failed cache read/write', async () => {
    const args = setup({ readCache: vi.fn().mockRejectedValue(new Error('Storage unavailable')), writeCache: vi.fn().mockRejectedValue(new Error('Quota')) });
    expect(await loadProjectDetail(args)).toBe('ready');
    expect(args.onData).toHaveBeenCalledExactlyOnceWith({ project: { id: 'p1' } });
  });
  it('does not apply a late response after navigating away', async () => {
    const controller = new AbortController();
    const args = setup({ signal: controller.signal, request: vi.fn().mockImplementation(async () => {
      controller.abort();
      return new Response(JSON.stringify({ project: { id: 'p1' } }));
    }) });
    await loadProjectDetail(args);
    expect(args.onData).not.toHaveBeenCalled();
    expect(args.writeCache).not.toHaveBeenCalled();
  });
  it('settles a stalled network request after the timeout', async () => {
    const args = setup({ timeoutMs: 5, request: vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
    })) });
    expect(await loadProjectDetail(args)).toBe('error');
  });
});
