// @vitest-environment jsdom
// Cartouche « Stockage » de la barre latérale : discret, il ne porte plus le détail par utilisateur (déplacé
// dans l'onglet « Stockage » des paramètres, voir storageUsageCard.test.ts) mais y mène d'un clic.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { StorageCartouche, STORAGE_SETTINGS_PATH } from '../src/components/StorageCartouche';
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

async function show(usage: StorageUsage | Error, collapsed = false) {
  if (usage instanceof Error) vi.mocked(apiFetch).mockRejectedValue(usage);
  else vi.mocked(apiFetch).mockResolvedValue(usage);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, null, React.createElement(StorageCartouche, { collapsed })));
  });
}

const settingsLink = () => host.querySelector(`a[href="${STORAGE_SETTINGS_PATH}"]`) as HTMLAnchorElement | null;

describe('StorageCartouche', () => {
  it('affiche le total, le plafond et une jauge fine pour le cabinet', async () => {
    await show(adminUsage);

    expect(apiFetch).toHaveBeenCalledWith('/api/billing/storage');
    expect(host.textContent).toContain('storage_cartouche_of|{"used":"92 Mo","limit":"50 Go"}');
    const bar = host.querySelector('[role=progressbar]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('mène aux paramètres en cliquant sur « Stockage », avec le tooltip « Voir le détail par utilisateur »', async () => {
    await show(adminUsage);

    const link = settingsLink()!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/settings?tab=stockage');
    expect(link.getAttribute('title')).toBe('storage_cartouche_details_show');
    expect(link.textContent).toContain('storage_cartouche_title');
  });

  it('ne porte plus de détail par utilisateur ni de bouton de dépliage, quel que soit le profil', async () => {
    await show(adminUsage);
    expect(host.textContent).not.toContain('Samir Benali');
    expect(host.textContent).not.toContain('storage_cartouche_unattributed');
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);

    await show({
      ...adminUsage,
      breakdown: { scope: 'self', users: [{ name: 'Léa Martin', bytes: 8 * MB, files: 2, is_me: true }], unattributed_bytes: null },
    });
    expect(host.textContent).not.toContain('storage_cartouche_mine');
    expect(host.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('propose toujours de changer de forfait, près du plafond comme loin de celui-ci', async () => {
    await show({ ...adminUsage, used_bytes: 45 * GB });
    expect(host.querySelector('a[href="/billing"]')?.textContent).toBe('storage_cartouche_upgrade');
    await act(async () => root.unmount());
    root = createRoot(host);

    await show(adminUsage);
    expect(host.querySelector('a[href="/billing"]')?.textContent).toBe('storage_cartouche_upgrade');
  });

  it('annonce un abonnement expiré sans jauge pour un plafond à zéro', async () => {
    await show({ ...adminUsage, plan: 'expired', limit_bytes: 0, breakdown: null });

    expect(host.textContent).toContain('storage_cartouche_expired');
    expect(host.querySelector('[role=progressbar]')).toBeNull();
    expect(host.querySelector('a[href="/billing"]')).not.toBeNull();
  });

  it('se réduit à une icône vers les paramètres, avec étiquette accessible et tooltip, quand la barre est repliée', async () => {
    await show(adminUsage, true);

    const link = settingsLink()!;
    expect(link.getAttribute('aria-label')).toContain('storage_cartouche_aria');
    expect(link.getAttribute('title')).toContain('storage_cartouche_details_show');
    expect(host.querySelector('[role=progressbar]')).toBeNull();
    expect(host.textContent).not.toContain('Samir Benali');
  });

  it('n\'affiche rien quand la lecture échoue', async () => {
    await show(new Error('réseau'));
    expect(host.textContent).toBe('');
  });
});
