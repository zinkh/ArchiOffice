// @vitest-environment jsdom
// Écrans de chantier du confrère : réserves (chiffres, retard, filtre, statut), ACT (meilleur prix) et le détail
// accordé par le cabinet (présences, pénalités, photos, adresses, issue #688). Données synthétiques.
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
// Le lecteur de plans (pdf.js) ne tourne pas sous jsdom : un double rend le repère et un bouton qui simule le clic sur le plan.
vi.mock('../src/components/PlanAnnotator', () => ({
  PlanAnnotator: (p: any) => React.createElement('div', { 'data-testid': 'plan', 'data-file': p.fileUrl, 'data-pdf': String(p.isPdf), 'data-markers': JSON.stringify(p.markers) },
    React.createElement('button', { type: 'button', 'data-testid': 'plan-click', disabled: !p.isAddingMode, onClick: () => p.onAddMarker(10.123, 20) }, 'clic')),
}));

import { SharedAct, SharedReports, SharedReserves } from '../src/components/SharedChantier';

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

const REPORT_BASE = { id: 'rep1', report_number: 4, date: '2026-11-13', statut: 'brouillon', meteo: null, temperature: null, meetingNotes: null, nextMeeting: null };
const REPORTS = [{
  ...REPORT_BASE,
  attendance: [{ name: 'Ana Roy', role: 'Maçon', status: 'P', present: true, excused: false }, { name: 'Luc Pic', role: 'Plombier', status: 'ANE', present: false, excused: false }],
  lot_tracking: [{
    lot_id: 'l1', lot_label: '01 Gros œuvre', status: 'R', effectif: 6, retard_semaine: 2, retard_cumule: 5, intemperies_jours: 1,
    penalites: [{ id: 'p1', type: 'retard_execution', motif: null, jours: 3, montant_jour: 150.5, montant: 451.5 }],
  }],
}];
const NOTES = [{ id: 'n1', category: 'Gros œuvre', note_number: 1, responsible_company: null, issue_date: null, due_date: null, status: 'open', text: 'Chaînage', photoCount: 2 }];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/photos/')) return { url: 'https://files.test/photo.jpg' };
    if (url.endsWith('/reserves')) return RESERVES;
    if (url.endsWith('/act')) return ACT;
    if (url.endsWith('/reports')) return REPORTS;
    if (url.endsWith('/notes')) return NOTES;
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

describe('Détail accordé par le cabinet (issue #688)', () => {
  it('sans détail : le compte rendu n\'affiche ni présences, ni pénalités, ni photos', async () => {
    // Le serveur n'envoie rien de tout cela sans détail ; l'écran ne l'invente pas.
    apiFetch.mockImplementation(async (url: string) => (url.endsWith('/reports') ? [REPORT_BASE] : url.endsWith('/notes') ? [{ ...NOTES[0], photoCount: undefined }] : []));
    await monter(React.createElement(SharedReports, { projectId: 'p', canWrite: false }));
    expect(container.textContent).not.toContain('shared_attendance_title');
    expect(container.textContent).not.toContain('shared_tracking_title');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('avec le détail : présences, suivi par lot, pénalités et photos des rubriques', async () => {
    await monter(React.createElement(SharedReports, { projectId: 'p', canWrite: false, detail: true }));
    const texte = (container.textContent ?? '').replace(/[  ]/g, ' ');
    expect(texte).toContain('Ana Roy');
    expect(texte).toContain('ANE'); // statut de présence en pastille
    expect(texte).toContain('01 Gros œuvre');
    expect(texte).toContain('451,50 €'); // montant de la pénalité
    expect(texte).toContain('shared_penalty_total');
    // Deux photos : chacune lit son lien à l'affichage, jamais une adresse stockée dans les données.
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute('src')).toBe('https://files.test/photo.jpg');
    expect(apiFetch.mock.calls.map(c => String(c[0])).filter(u => u.includes('/photos/'))).toEqual([
      '/api/shared/projects/p/reports/rep1/notes/n1/photos/0', '/api/shared/projects/p/reports/rep1/notes/n1/photos/1',
    ]);
  });

  it('avec le détail : les photos d\'une réserve s\'affichent dans son détail, miniature puis grand format au clic', async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/photos/')) return { url: 'https://files.test/photo.jpg' };
      if (url.endsWith('/reserves')) return [{ ...base, id: 'r1', number: 1, title: 'Fissure', status: 'A faire', due_date: null, photos: [{ id: 'ph1', caption: 'Vue Est', has_thumb: true }] }];
      return [];
    });
    await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: false, detail: true }));
    expect(container.querySelectorAll('img')).toHaveLength(0); // replié : rien n'est chargé
    await act(async () => { (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/shared/projects/p/reserves/r1/photos/ph1?thumb=1');
  });

  describe('intitulé et position sur le plan (issue #687)', () => {
    const PLANS = [{ id: 'pl1', name: 'Plan RDC', pdf: true }];
    const reserve = (extra: Record<string, unknown> = {}) => ({ ...base, id: 'r1', number: 1, title: 'Fissure', status: 'A faire', due_date: null, photos: [], plan_id: null, x: null, y: null, ...extra });
    const lireUrl = (m: any) => String(m[0]);
    const setupApi = (extra: Record<string, unknown> = {}) => {
      apiFetch.mockImplementation(async (url: string, init?: any) => {
        if (init?.method === 'PUT') return { ...reserve(extra), ...JSON.parse(init.body) };
        if (url.endsWith('/plans')) return PLANS;
        if (url.endsWith('/reserves')) return [reserve(extra)];
        return [];
      });
    };
    const ouvrir = async () => {
      await act(async () => { (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click(); });
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    };
    const bouton = (texte: string) => [...container.querySelectorAll('button')].find(b => b.textContent === texte) as HTMLButtonElement;
    const puts = () => apiFetch.mock.calls.filter(c => (c[1] as any)?.method === 'PUT');

    it('renomme la réserve à la sortie du champ, jamais avec un intitulé vide', async () => {
      setupApi();
      await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: true }));
      await ouvrir();
      const champ = container.querySelector('input[aria-label="shared_reserve_title"]') as HTMLInputElement;
      const saisir = async (valeur: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ, valeur);
        await act(async () => { champ.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
      };
      await saisir('');
      expect(puts()).toHaveLength(0);
      await saisir('Fissure du refend');
      expect(puts()).toHaveLength(1);
      expect(JSON.parse((puts()[0][1] as any).body)).toEqual({ title: 'Fissure du refend' });
    });

    it('en lecture seule, l\'intitulé est grisé', async () => {
      setupApi();
      await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: false }));
      await ouvrir();
      expect((container.querySelector('input[aria-label="shared_reserve_title"]') as HTMLInputElement).disabled).toBe(true);
    });

    it('sans détail : aucun plan, aucune demande de plan', async () => {
      setupApi();
      await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: true }));
      await ouvrir();
      expect(container.querySelector('[data-testid="plan"]')).toBeNull();
      expect(apiFetch.mock.calls.some(c => lireUrl(c).includes('/plans'))).toBe(false);
    });

    it('avec le détail : le plan se lit par la route du partage, repère compris', async () => {
      setupApi({ plan_id: 'pl1', x: 12.5, y: 40 });
      await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: false, detail: true }));
      await ouvrir();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      const plan = container.querySelector('[data-testid="plan"]') as HTMLElement;
      expect(plan.dataset.file).toBe('/api/shared/projects/p/reserves/plans/pl1/file');
      expect(plan.dataset.pdf).toBe('true');
      expect(JSON.parse(plan.dataset.markers!)).toEqual([expect.objectContaining({ id: 'r1', x: 12.5, y: 40 })]);
      expect(bouton('shared_plan_move')).toBeUndefined(); // lecture seule : pas de bouton de déplacement
    });

    it('place le repère : clic sur le plan, puis enregistrement de la position', async () => {
      setupApi();
      await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: true, detail: true }));
      await ouvrir();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      await act(async () => { bouton('shared_plan_place').click(); });
      expect(bouton('shared_plan_save')).toBeUndefined(); // rien à enregistrer avant le clic
      await act(async () => { (container.querySelector('[data-testid="plan-click"]') as HTMLButtonElement).click(); });
      await act(async () => { bouton('shared_plan_save').click(); });
      expect(puts()).toHaveLength(1);
      expect(JSON.parse((puts()[0][1] as any).body)).toEqual({ plan_id: 'pl1', x: 10.12, y: 20 });
    });

    it('retire le repère : plan et coordonnées s\'effacent ensemble', async () => {
      setupApi({ plan_id: 'pl1', x: 12.5, y: 40 });
      await monter(React.createElement(SharedReserves, { projectId: 'p', kind: 'reserves', canWrite: true, detail: true }));
      await ouvrir();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      await act(async () => { bouton('shared_plan_remove').click(); });
      expect(JSON.parse((puts()[0][1] as any).body)).toEqual({ plan_id: null, x: null, y: null });
    });
  });

  it('avec le détail : adresses des entreprises et rappel que la fiche reste au cabinet ; sans détail, rien', async () => {
    const act1 = { ...ACT, entreprises: [{ ...ACT.entreprises[0], email: 'alpha@example.test', emails_supplementaires: 'b@example.test' }] };
    apiFetch.mockImplementation(async (url: string) => (url.endsWith('/act') ? act1 : []));
    await monter(React.createElement(SharedAct, { projectId: 'p', canPropose: false, detail: true }));
    expect(container.textContent).toContain('alpha@example.test ; b@example.test');
    expect(container.textContent).toContain('shared_contacts_note');
    await act(async () => root.unmount());
    container.remove();
    await monter(React.createElement(SharedAct, { projectId: 'p', canPropose: false }));
    expect(container.textContent).not.toContain('shared_contacts_note');
    expect(container.textContent).not.toContain('shared_col_email');
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
