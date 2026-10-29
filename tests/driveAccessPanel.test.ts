// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DriveAccessPanel } from '../src/components/DriveAccessPanel';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: api }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; api.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(DriveAccessPanel))); });
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
it('offers billing only when payment is required, without claiming native sync is active', async () => {
  api.mockImplementation(async (url: string) => url.endsWith('capabilities') ? { enabled: false, code: 'DRIVE_SUBSCRIPTION_REQUIRED' } : []);
  await render(); expect(host.querySelector('a')?.getAttribute('href')).toBe('/billing');
  expect(host.textContent).toContain('drive_access_native_pending'); expect(host.textContent).toContain('drive_access_empty');
});
it('keeps devices manageable when capability lookup fails and confirms disconnection', async () => {
  let disconnected = false;
  api.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith('capabilities')) throw new Error('unavailable');
    if (options?.method === 'DELETE') { disconnected = true; return { success: true }; }
    return disconnected ? [] : [{ id: 'device1', name: 'Poste atelier', platform: 'windows' }];
  });
  await render(); expect(host.textContent).toContain('drive_access_error'); expect(host.textContent).toContain('Poste atelier');
  await act(async () => button('drive_access_disconnect').click());
  expect(api.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);
  await act(async () => button('drive_access_confirm_action').click());
  expect(api.mock.calls.some(([url, o]) => url.endsWith('/device1') && o?.method === 'DELETE')).toBe(true);
  expect(host.textContent).not.toContain('Poste atelier');
});
it('shows eligible access and retains a device when disconnection fails', async () => {
  api.mockImplementation(async (url: string, options: any) => {
    if (options?.method === 'DELETE') throw new Error('down');
    return url.endsWith('capabilities') ? { enabled: true } : [{ id: 'device1', name: 'Poste atelier', platform: 'macos' }];
  });
  await render(); expect(host.textContent).toContain('drive_access_eligible'); expect(host.querySelector('a')).toBeNull();
  await act(async () => button('drive_access_disconnect').click());
  await act(async () => button('drive_access_confirm_action').click());
  expect(host.textContent).toContain('drive_access_revoke_error'); expect(host.textContent).toContain('Poste atelier');
});
it('connects a local workstation without placing credentials in the page', async () => {
  let connected = false;
  api.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith('/local/connect')) { connected = true; return { enabled: true, local: true }; }
    if (url.endsWith('capabilities')) return { enabled: connected, local: true, code: connected ? null : 'DRIVE_ONLINE_VERIFICATION_REQUIRED' };
    return [];
  });
  await render();
  await act(async () => button('drive_local_connect').click());
  expect(api.mock.calls.some(([url, o]) => url.endsWith('/local/connect') && o?.method === 'POST')).toBe(true);
  expect(host.textContent).toContain('drive_local_authorized');
  expect(host.querySelector('input')).toBeNull();
});
it('does not offer local activation before trust configuration exists', async () => {
  api.mockImplementation(async (url: string) => url.endsWith('capabilities') ? { enabled: false, local: true, code: 'DRIVE_TRUST_UNCONFIGURED' } : []);
  await render(); expect(host.textContent).toContain('drive_local_unconfigured');
  expect(button('drive_local_connect')).toBeUndefined();
});
it('uses the native file picker bridge without accepting a path in the page and permits explicit retry', async () => {
  const pick = vi.fn().mockResolvedValue({ queued: true, jobId: 'job1' });
  const retry = vi.fn().mockResolvedValue({ retried: 1 });
  (window as any).archiofficeDesktop = { isDesktop: true, enqueueDriveFile: pick, retryDriveTransfers: retry,
    getDriveStatus: vi.fn().mockResolvedValue({state:'paused',pending:0,blocked:1,conflicts:0}) };
  api.mockImplementation(async (url: string) => url.endsWith('capabilities') ? {enabled:true,local:true} : []);
  try {
    await render();
    await act(async () => button('drive_transfer_add').click());
    expect(pick).toHaveBeenCalledWith();
    expect(host.textContent).toContain('drive_transfer_queued');
    expect(host.querySelector('input[type="file"]')).toBeNull();
    await act(async () => button('drive_transfer_retry').click());
    expect(retry).toHaveBeenCalledWith();expect(host.textContent).toContain('drive_transfer_retried');
  } finally { delete (window as any).archiofficeDesktop; }
});
