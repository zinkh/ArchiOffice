// @vitest-environment jsdom
// Cartouche « Stockage » de la barre latérale : ce que voit chaque profil.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { StorageCartouche } from '../src/components/StorageCartouche';
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
  try { localStorage.clear(); } catch { /* sans stockage */ }
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

const detailsButton = () => host.querySelector('button[aria-expanded]') as HTMLButtonElement | null;

describe('StorageCartouche', () => {
  it('affiche le total, le plafond et une jauge pour le cabinet', async () => {
    await show(adminUsage);

    expect(apiFetch).toHaveBeenCalledWith('/api/billing/storage');
    expect(host.textContent).toContain('storage_cartouche_of|{"used":"92 Mo","limit":"50 Go"}');
    const bar = host.querySelector('[role=progressbar]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('replie le détail par utilisateur par défaut, puis le déplie à la demande', async () => {
    await show(adminUsage);
    expect(host.textContent).not.toContain('Samir Benali');

    await act(async () => { detailsButton()!.click(); });

    expect(detailsButton()!.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Camille Durand (storage_cartouche_you)');
    expect(host.textContent).toContain('Samir Benali');
    expect(host.textContent).toContain('60 Mo');
    expect(host.textContent).toContain('storage_cartouche_unattributed');
    expect(host.textContent).toContain('25 Mo');
  });

  it('retient le choix de dépliage entre deux affichages', async () => {
    await show(adminUsage);
    await act(async () => { detailsButton()!.click(); });
    await act(async () => root.unmount());
    root = createRoot(host);

    await show(adminUsage);

    expect(host.textContent).toContain('Samir Benali');
  });

  it('ne montre à un collaborateur que sa propre ligne, sans bouton de détail', async () => {
    await show({
      ...adminUsage,
      breakdown: { scope: 'self', users: [{ name: 'Léa Martin', bytes: 8 * MB, files: 2, is_me: true }], unattributed_bytes: null },
    });

    expect(host.textContent).toContain('storage_cartouche_mine');
    expect(host.textContent).toContain('8 Mo');
    expect(detailsButton()).toBeNull();
    expect(host.textContent).not.toContain('Samir');
  });

  it('propose de changer de plan à partir de 80 % du plafond', async () => {
    await show({ ...adminUsage, used_bytes: 45 * GB });
    expect(host.querySelector('a[href="/billing"]')?.textContent).toBe('storage_cartouche_upgrade');
  });

  it('ne propose pas de changer de plan loin du plafond', async () => {
    await show(adminUsage);
    expect(host.querySelector('a[href="/billing"]')).toBeNull();
  });

  it('annonce un abonnement expiré sans jauge pour un plafond à zéro', async () => {
    await show({ ...adminUsage, plan: 'expired', limit_bytes: 0, breakdown: null });

    expect(host.textContent).toContain('storage_cartouche_expired');
    expect(host.querySelector('[role=progressbar]')).toBeNull();
    expect(host.querySelector('a[href="/billing"]')).not.toBeNull();
  });

  it('garde le total quand la répartition par auteur n\'est pas disponible', async () => {
    await show({ ...adminUsage, breakdown: null });

    expect(host.textContent).toContain('storage_cartouche_of');
    expect(detailsButton()).toBeNull();
  });

  it('se réduit à une icône avec une étiquette accessible quand la barre est repliée', async () => {
    await show(adminUsage, true);

    const link = host.querySelector('a[href="/billing"]')!;
    expect(link.getAttribute('aria-label')).toContain('storage_cartouche_aria');
    expect(host.querySelector('[role=progressbar]')).toBeNull();
    expect(host.textContent).not.toContain('Samir Benali');
  });

  it('n\'affiche rien quand la lecture échoue', async () => {
    await show(new Error('réseau'));
    expect(host.textContent).toBe('');
  });
});
