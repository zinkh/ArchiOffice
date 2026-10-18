// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch } from '../src/components/GlobalSearch';
const mocks = vi.hoisted(() => ({ request: vi.fn(), t: (key: string, opts?: any) => opts?.query ? `${key} ${opts.query}` : key }));
vi.mock('../src/lib/api', () => ({ apiFetch: mocks.request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
const data = (label?: string) => ({ projects: label ? [{ id: label, _label: label }] : [], contacts: [], tenders: [], invoices: [] });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.request.mockReset(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(scopeKey = 'practice-a:user') {
  if (!root || !container?.isConnected) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(GlobalSearch, { scopeKey }))));
}
const field = () => container.querySelector('input')!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const advance = async (ms = 300) => { await act(async () => vi.advanceTimersByTime(ms)); };
const retryButton = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'retry_btn')!;
describe('global search user feedback and request ownership', () => {
  it('distinguishes waiting, failure and a successful retry without losing the query', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValueOnce(data('Dupont'));
    await render(); await type('Dupont');
    expect(container.querySelector('[role="status"]')!.textContent).toBe('global_search_loading');
    await advance(299); expect(mocks.request).not.toHaveBeenCalled();
    await advance(1);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('global_search_failed');
    expect(container.textContent).not.toContain('global_search_empty'); expect(field().value).toBe('Dupont');
    await act(async () => retryButton().click());
    expect(document.activeElement).toBe(field());
    await advance();
    expect(container.querySelector('a')!.textContent).toContain('Dupont');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it.each(['resolve', 'reject'] as const)('ignores a stale %s after a newer query succeeds', async completion => {
    let finish!: (value: any) => void; let fail!: (reason: any) => void;
    mocks.request.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }))
      .mockResolvedValueOnce(data('Beta'));
    await render(); await type('Alpha'); await advance();
    const signal = mocks.request.mock.calls[0][1].signal as AbortSignal;
    await type('Beta'); expect(signal.aborted).toBe(true); await advance();
    await act(async () => { if (completion === 'resolve') finish(data('Alpha')); else fail(new Error('Late failure')); });
    expect(container.querySelector('a')!.textContent).toContain('Beta');
    expect(container.textContent).not.toContain('Alpha'); expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('removes old results immediately when a query changes', async () => {
    mocks.request.mockResolvedValue(data('Alpha'));
    await render(); await type('Alpha'); await advance(); expect(container.querySelector('a')).not.toBeNull();
    await type('Beta'); expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('global_search_loading');
  });
  it('invalidates visible results when switching practices with the same query', async () => {
    mocks.request.mockResolvedValueOnce(data('Cabinet A')).mockResolvedValueOnce(data('Cabinet B'));
    await render(); await type('Dupont'); await advance();
    expect(container.textContent).toContain('Cabinet A');
    await render('practice-b:user'); expect(container.textContent).not.toContain('Cabinet A');
    await advance(); expect(container.textContent).toContain('Cabinet B');
  });
  it('ignores a previous practice response even if the request ignores abort', async () => {
    let finish!: (value: any) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(data('Cabinet B'));
    await render(); await type('Dupont'); await advance();
    await render('practice-b:user'); await advance();
    await act(async () => finish(data('Cabinet A')));
    expect(container.textContent).toContain('Cabinet B'); expect(container.textContent).not.toContain('Cabinet A');
  });
  it.each(['', 'a', '   ', ' a '])('does not search the short/empty normalized query %j', async query => {
    await render(); await type(query); await advance();
    expect(mocks.request).not.toHaveBeenCalled(); expect(container.querySelector('[role="region"]')).toBeNull();
  });
  it('shows no results only after a confirmed empty response', async () => {
    mocks.request.mockResolvedValue(data());
    await render(); await type('Dupont'); await advance();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('global_search_empty Dupont');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('reports malformed results as a failure instead of crashing or claiming no match', async () => {
    mocks.request.mockResolvedValue({ projects: 'invalid' });
    await render(); await type('Dupont'); await advance();
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.textContent).not.toContain('global_search_empty');
  });
  it('stops a stalled request after 20 seconds and allows a retry', async () => {
    mocks.request.mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')))));
    await render(); await type('Dupont'); await advance(); await advance(20000);
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(retryButton()).toBeDefined();
    expect(container.querySelector('[role="region"]')!.getAttribute('aria-busy')).toBe('false');
  });
  it('preserves Ctrl+K and Escape, and aborts work when the field is cleared', async () => {
    mocks.request.mockImplementation(() => new Promise(() => {}));
    await render(); await type('Dupont'); await advance();
    const signal = mocks.request.mock.calls[0][1].signal as AbortSignal;
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="region"]')).toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })));
    expect(document.activeElement).toBe(field()); expect(container.querySelector('[role="region"]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(field().value).toBe(''); expect(signal.aborted).toBe(true);
  });
});
