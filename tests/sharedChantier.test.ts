// @vitest-environment jsdom
// Écrans de chantier du confrère : réserves (chiffres, retard, filtre, statut) et ACT (meilleur prix).
// Données synthétiques.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('react-i18next', () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key);
  return { useTranslation: () => ({ t }) };
});
// La liste des réserves du cabinet tire pdf.js et le client Supabase : sans objet ici.
vi.mock('../src/lib/planRender', () => ({ renderPlanExcerpt: vi.fn() }));
vi.mock('../src/components/SignedImage', () => ({ SignedImage: () => null }));
vi.mock('../src/lib/reservePhotoQueue', () => ({ photoDisplaySrc: () => '' }));

import { SharedAct, SharedReserves } from '../src/components/SharedChantier';

const base = { batiment: null, local: null, lots: null, entreprises: null, description: null, reponse: null };
const RESERVES = [
  { ...base, id: 'r1', number: 1, title: 'Fissure', status: 'A faire', due_date: '2000-01-01' },
  { ...base, id: 'r2', number: 2, title: 'Peinture', status: 'Levée', due_date: '2000-01-01' },
  { ...base, id: 'r3', number: 3, title: 'Plinthe', status: 'Pour mémoire', due_date: '2000-01-01' },
  { ...base, id: 'r4', number: 4, title: 'Joint', status: 'En cours', due_date: '2999-01-01' },
];
const ACT = {
  phase: 'ACT', lots: [{ id: 'L1', name: 'Gros oeuvre' }], documents: [],
  entreprises: [{ id: 'e1', nom: 'Alpha', lots_ids: ['L1'], dce_transmis_le: null, relance_le: null, offre_recue_le: null, ne_repond_pas: false }],
  offres: [
    { id: 'o1', lot_id: 'L1', entreprise_id: 'e1', montant_base: 1000, note_technique: null, conforme: true, motif_nc: null },
    { id: 'o2', lot_id: 'L1', entreprise_id: 'e1', montant_base: 900, note_technique: null, conforme: true, motif_nc: null },
    { id: 'o3', lot_id: 'L1', entreprise_id: 'e1', montant_base: 800, note_technique: null, conforme: false, motif_nc: 'Hors cadre' },
  ],
  attributions: [], questions: [], marches: [],
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/reserves')) return RESERVES;
    if (url.endsWith('/act')) return ACT;
    return [];
  });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function monter(element: React.ReactElement) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const kpi = (label: string) => [...container.querySelectorAll('dt')].find(d => d.textContent === label)?.nextElementSibling?.textContent;
const lignes = () => container.querySelectorAll('tbody tr').length;

describe('SharedReserves : suivi des réserves', () => {
  it('compte les réserves, celles à lever, en retard et levées (une réserve pour mémoire n\'est jamais en retard)', async () => {
    await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: false }));
    expect(kpi('shared_kpi_total')).toBe('4');
    expect(kpi('shared_kpi_open')).toBe('2'); // à faire et en cours ; ni la levée ni la pour mémoire
    expect(kpi('shared_kpi_late')).toBe('1'); // seule la réserve à faire, échéance dépassée
    expect(kpi('shared_kpi_done')).toBe('1');
    expect(container.textContent).toContain('shared_late_days');
  });

  it('filtre le tableau par état', async () => {
    await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: false }));
    expect(lignes()).toBe(4);
    const bouton = (texte: string) => [...container.querySelectorAll('button[aria-pressed]')].find(b => b.textContent === texte) as HTMLButtonElement;
    await act(async () => { bouton('shared_kpi_late').click(); });
    expect(lignes()).toBe(1);
    expect(container.textContent).toContain('Fissure');
    await act(async () => { bouton('shared_kpi_done').click(); });
    expect(container.textContent).toContain('Peinture');
    expect(lignes()).toBe(1);
  });

  it('en lecture seule le statut est une pastille, avec le droit il se change', async () => {
    await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: false }));
    expect(container.querySelectorAll('select')).toHaveLength(0);
    await act(async () => root.unmount());
    container.remove();
    await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: true }));
    expect(container.querySelectorAll('select')).toHaveLength(4);
  });
});

describe('SharedAct : comparatif des offres', () => {
  it('repère la meilleure offre conforme du lot, jamais une offre non conforme moins chère', async () => {
    await monter(React.createElement(SharedAct, { projectId: 'p', canPropose: false }));
    const pastilles = [...container.querySelectorAll('span')].filter(s => s.textContent === 'shared_act_best');
    expect(pastilles).toHaveLength(1);
    expect(pastilles[0].closest('td')?.textContent).toContain('900'); // 900 € : 800 € est non conforme
  });
});
