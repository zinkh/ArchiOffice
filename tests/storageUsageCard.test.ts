// @vitest-environment jsdom
// Onglet « Stockage » des paramètres : le détail par utilisateur qui était dans la barre latérale.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { StorageUsageCard } from '../src/components/StorageUsageCard';
import { apiFetch } from '../src/lib/api';
import type { StorageUsage } from '../src/lib/storageUsage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}|${JSON.stringify(params)}` : key),
    i18n: { language: 'fr' },
  }),
}));
vi.mock('../src/lib/api', () => ({ apiFetch: vi.fn() }));

const MB = 1024 * 1024;
const GB = 1024 * MB;
let host: HTMLDivElement;
let root: Root;

const adminUsage: StorageUsage = {
  plan: 'pro',
  used_bytes: 92 * MB,
  limit_bytes: 50 * GB,
  breakdown: {
    scope: 'all',
    users: [
      { name: 'Camille Durand', bytes: 60 * MB, files: 4, is_me: true },
      { name: 'Samir Benali', bytes: 7 * MB, files: 1, is_me: false },
    ],
    unattributed_bytes: 25 * MB,
  },
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiFetch).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function show(usage: StorageUsage) {
  vi.mocked(apiFetch).mockResolvedValue(usage);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, null, React.createElement(StorageUsageCard)));
  });
}

describe('StorageUsageCard', () => {
  it('montre la part de chaque utilisateur et le non attribué à un administrateur, sans rien à déplier', async () => {
    await show(adminUsage);

    expect(host.textContent).toContain('storage_cartouche_of|{"used":"92 Mo","limit":"50 Go"}');
    expect(host.textContent).toContain('Camille Durand (storage_cartouche_you)');
    expect(host.textContent).toContain('Samir Benali');
    expect(host.textContent).toContain('60 Mo');
    expect(host.textContent).toContain('storage_cartouche_unattributed');
    expect(host.textContent).toContain('25 Mo');
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('ne montre à un collaborateur que sa propre ligne', async () => {
    await show({
      ...adminUsage,
      breakdown: { scope: 'self', users: [{ name: 'Léa Martin', bytes: 8 * MB, files: 2, is_me: true }], unattributed_bytes: null },
    });

    expect(host.textContent).toContain('storage_cartouche_mine');
    expect(host.textContent).toContain('8 Mo');
    expect(host.textContent).not.toContain('Samir');
  });

  it('garde le total et propose de changer de forfait quand la répartition n\'est pas disponible', async () => {
    await show({ ...adminUsage, breakdown: null });

    expect(host.textContent).toContain('storage_cartouche_of');
    expect(host.textContent).toContain('storage_settings_no_detail');
    expect(host.querySelector('a[href="/billing"]')).not.toBeNull();
  });

  it('annonce un abonnement expiré sans jauge', async () => {
    await show({ ...adminUsage, plan: 'expired', limit_bytes: 0, breakdown: null });

    expect(host.textContent).toContain('storage_cartouche_expired');
    expect(host.querySelector('[role=progressbar]')).toBeNull();
  });
});
