import { describe, it, expect, vi } from 'vitest';
import { mutateVisa } from '../visaMutation';
import type { Visa } from '../../types';
const visa = { id: 'v1', title: 'Plan EXE', status: 'pending' } as Visa;
describe('VISA quick actions', () => {
  it.each(['approved', 'rejected'] as const)('sends the requested review: %s', async action => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await mutateVisa(visa, action, request);
    expect(request).toHaveBeenCalledWith('/api/visas/v1', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ...visa, status: action }) }));
    expect(visa.status).toBe('pending');
  });
  it('accepts an empty deletion response', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(mutateVisa(visa, 'delete', request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith('/api/visas/v1', expect.objectContaining({ method: 'DELETE' }));
  });
  it.each([403, 500, 503])('rejects HTTP %s rather than reporting success', async status => {
    await expect(mutateVisa(visa, 'approved', vi.fn().mockResolvedValue(new Response(null, { status })))).rejects.toThrow('not confirmed');
  });
  it('propagates a network failure', async () => {
    await expect(mutateVisa(visa, 'delete', vi.fn().mockRejectedValue(new TypeError('Offline')))).rejects.toThrow('Offline');
  });
  it('ends a stalled mutation without claiming it was saved', async () => {
    const request = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
    }));
    await expect(mutateVisa(visa, 'approved', request, 5)).rejects.toThrow('Timeout');
  });
});
