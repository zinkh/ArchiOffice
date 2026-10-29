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
  api.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith('capabilities')) throw new Error('unavailable');
    if (options?.method === 'DELETE') return { success: true };
    return [{ id: 'device1', name: 'Poste atelier', platform: 'windows' }];
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
