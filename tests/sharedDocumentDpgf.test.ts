// @vitest-environment jsdom
// Écran du confrère : le DPGF en grille, comme dans l'éditeur (colonnes, sous-total du lot, détail repliable
// pour proposer un prix). Données synthétiques.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('react-i18next', () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key);
  return { useTranslation: () => ({ t }) };
});

import SharedDocument from '../src/components/SharedDocument';

const VUE = {
  titre: 'DPGF Villa', version: 'V1',
  lots: [{
    id: 'lot-a', numero: '01', titre: 'Façades', projectLotId: 'L1',
    chapitres: [{
      id: 'c1', numero: '1', titre: 'Enduits', cctpDescription: null,
      lignes: [
        { id: 'a1', numero: '1.1', designation: 'Enduit', unite: 'm²', localisation: null, cctpDescription: null, quantite: 10, prixUnitaire: 20, prixTotal: 200, pourMemoire: false },
        { id: 'a2', numero: '1.2', designation: 'Peinture', unite: 'm²', localisation: null, cctpDescription: null, quantite: 5, prixUnitaire: 10, prixTotal: 50, pourMemoire: false },
        { id: 'a3', numero: '1.3', designation: 'Échafaudage', unite: 'u', localisation: null, cctpDescription: null, quantite: 1, prixUnitaire: 999, prixTotal: 999, pourMemoire: true },
      ],
    }],
  }],
};

const ECRITURE = [{ kind: 'dpgf', access: 'write' as const }];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => (url.endsWith('/dpgf') ? VUE : []));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function monter(grants: { kind: string; access: 'read' | 'comment' | 'write' }[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(SharedDocument, { projectId: 'p', mode: 'dpgf', grants, archived: false })); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const texte = () => (container.textContent ?? '').replace(/[  ]/g, ' ');
const boutons = (contient: string) => [...container.querySelectorAll('button')].filter(b => (b.textContent ?? '').includes(contient));

describe('SharedDocument : le DPGF en grille', () => {
  it('affiche un tableau avec ses colonnes et une ligne par lot, chapitre et article', async () => {
    await monter(ECRITURE);
    expect(container.querySelector('table')).not.toBeNull();
    for (const colonne of ['shared_col_numero', 'shared_col_designation', 'shared_col_quantite', 'shared_col_pu', 'shared_col_total']) {
      expect(texte()).toContain(colonne);
    }
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1 + 1 + 3); // lot, chapitre, trois articles
    expect(texte()).toContain('Enduit');
  });

  it('calcule le sous-total du lot depuis les articles, sans compter un « pour mémoire »', async () => {
    await monter(ECRITURE);
    // 200 + 50 ; l'échafaudage « pour mémoire » (999 €) n'entre pas dans le total.
    expect(texte()).toContain('250,00 €');
    expect(texte()).not.toContain('1 249,00 €');
    expect(texte()).toContain('shared_pm');
  });

  it('ne propose rien tant que le détail d\'une ligne n\'est pas ouvert, puis le prix et l\'unité', async () => {
    await monter(ECRITURE);
    expect(boutons('shared_field_prixUnitaire')).toHaveLength(0);
    const ouvrir = container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]');
    expect(ouvrir).toHaveLength(5);
    await act(async () => { ouvrir[2].click(); }); // la première ligne d'article
    expect(ouvrir[2].getAttribute('aria-expanded')).toBe('true');
    expect(boutons('shared_field_prixUnitaire')).toHaveLength(1);
    expect(boutons('shared_field_unite')).toHaveLength(1);
  });

  it('en lecture seule, le détail n\'offre aucune proposition', async () => {
    await monter([{ kind: 'dpgf', access: 'read' }]);
    const ouvrir = container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]');
    await act(async () => { ouvrir[2].click(); });
    expect(boutons('shared_propose')).toHaveLength(0);
  });
});
