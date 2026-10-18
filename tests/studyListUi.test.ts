// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudyList } from '../src/hooks/useStudyList';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: request }));
let host: HTMLDivElement;
let root: Root;
function Probe({ url }: { url: string }) {
  const state = useStudyList<string>(url);
  return React.createElement('button', { onClick: state.retry }, `${state.status}:${state.data.join(',')}`);
}
const render = async (url = '/first') => { await act(async () => root.render(React.createElement(Probe, { url }))); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); request.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
describe('study lists for DIAG, CT and CSPS', () => {
  it('distinguishes loading from a confirmed empty response', async () => {
    let resolve!: (value: string[]) => void;
    request.mockReturnValue(new Promise(r => { resolve = r; }));
    await render(); expect(host.textContent).toBe('loading:');
    await act(async () => resolve([])); expect(host.textContent).toBe('success:');
  });
  it('exposes errors and retries without changing the endpoint', async () => {
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['contact']);
    await render(); expect(host.textContent).toBe('error:');
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toBe('success:contact'); expect(request.mock.calls[1][0]).toBe('/first');
  });
  it('ignores a late response from another project or study kind', async () => {
    let resolve!: (value: string[]) => void;
    request.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce(['current']);
    await render(); await render('/second');
    await act(async () => resolve(['obsolete'])); expect(host.textContent).toBe('success:current');
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('rejects malformed lists', async () => {
    request.mockResolvedValue({ error: 'invalid' }); await render(); expect(host.textContent).toBe('error:');
  });
  it('bounds loading and ignores a response after the timeout', async () => {
    let resolve!: (value: string[]) => void;
    request.mockReturnValue(new Promise(r => { resolve = r; })); await render();
    await act(async () => vi.advanceTimersByTime(20_000)); expect(host.textContent).toBe('error:');
    await act(async () => resolve(['too late'])); expect(host.textContent).toBe('error:');
  });
});
