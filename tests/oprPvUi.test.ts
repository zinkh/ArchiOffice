// @vitest-environment jsdom
// Liste et formulaire des PV d'OPR (onglet AOR) : lignes, avertissement en marché public, création
// d'un PV, PV signé verrouillé. L'API est simulée ; les textes s'affichent sous leur clé.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const appels: Array<{ url: string; options?: RequestInit }> = [];
const receptions = [
  { id: 'r1', project_id: 'p1', regime: 'prive', marche_id: 'm1', reference_pv: 'OPR-2026-001', date_opr: '2026-11-03', proposition: { avis: 'sans_reserve' }, signed_at: null },
  { id: 'r2', project_id: 'p1', regime: 'prive', marche_id: 'm2', reference_pv: 'OPR-2026-002', date_opr: '2026-10-20', signed_at: '2026-11-10', signed_mode: 'papier' },
  { id: 'r-generique', project_id: 'p1', regime: null, date: '2026-01-01', type: 'OPR' },
];
const marches = [
  { id: 'm1', lot_numero: '01', lot_titre: 'Gros œuvre', entreprise_nom: 'BTS', type_marche: 'marche' },
  { id: 'm2', lot_numero: '02', lot_titre: 'Couverture', entreprise_nom: 'Toitures SA', type_marche: 'marche' },
  { id: 'm-cadre', lot_numero: '03', lot_titre: 'Accord-cadre', entreprise_nom: 'Cadre', type_marche: 'accord_cadre' },
];
const reserves = [{ id: 'x1', reception_id: 'r1', number: 1, batiment: null, local: 'Hall', title: 'Peinture', status: 'A faire', created_at: '2026-11-03' }];

vi.mock('../src/lib/api', () => ({
  apiFetch: vi.fn(async (url: string, options?: RequestInit) => {
    appels.push({ url, options });
    if (options?.method === 'POST' && url === '/api/receptions') return { id: 'nouveau' };
    if (options?.method) return {};
    if (url.startsWith('/api/receptions')) return receptions;
    if (url.startsWith('/api/reserves')) return reserves;
    if (url.startsWith('/api/marches-entreprises')) return marches;
    return [];
  }),
}));

import { OprPvSection } from '../src/components/aor/OprPvSection';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => { appels.length = 0; });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

async function monter(marchePublic = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(OprPvSection, {
    projectId: 'p1', projet: { nom: 'Hôtel Club', maitreOuvrage: 'SCI ACORIS' }, marchePublic, settings: { agencyName: 'AAZS' } as any,
  })));
  await act(async () => { await Promise.resolve(); });
}

const boutons = (texte: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent?.includes(texte));
const attendre = async () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function remplir(el: HTMLInputElement | HTMLSelectElement, valeur: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => { setter.call(el, valeur); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}

describe('liste des PV d\'OPR', () => {
  it('une ligne par PV privé de l\'affaire : lot, entreprise, référence, statut déduit, réserves ouvertes', async () => {
    await monter();
    const lignes = [...container.querySelectorAll('tbody tr')];
    expect(lignes).toHaveLength(2); // le PV générique n'est pas un PV d'OPR
    const texte = lignes.map(l => l.textContent ?? '');
    expect(texte[0] + texte[1]).toContain('Lot 01 · Gros œuvre');
    const r1 = texte.find(t => t.includes('OPR-2026-001'))!;
    expect(r1).toContain('BTS');
    expect(r1).toContain('opr_status_proposition_emise');
    expect(r1).toContain('1 / 1');
    expect(texte.find(t => t.includes('OPR-2026-002'))).toContain('opr_signed_on');
  });

  it('en marché public : avertissement sur les formulaires EXE et aucun bouton de création', async () => {
    await monter(true);
    expect(container.textContent).toContain('opr_public_notice');
    expect(boutons('opr_new')).toHaveLength(0);
  });
});

describe('création d\'un PV', () => {
  it('exige le lot, ne propose pas les accords-cadres, puis enregistre le marché choisi', async () => {
    await monter();
    await act(async () => boutons('opr_new')[0].click());
    const dialogue = document.body.querySelector('[role="dialog"]')!;
    expect(dialogue).toBeTruthy();

    const choixLot = dialogue.querySelector('select')!;
    expect([...choixLot.options].map(o => o.value)).toEqual(['', 'm1', 'm2']);

    await act(async () => boutons('opr_save')[0].click());
    expect(dialogue.textContent).toContain('opr_error_lot_required');
    expect(appels.some(a => a.options?.method === 'POST')).toBe(false);

    await remplir(choixLot, 'm2');
    await remplir(dialogue.querySelector<HTMLInputElement>('input[type="date"]')!, '2026-11-12');
    await act(async () => boutons('opr_save')[0].click());
    await attendre();

    const envoi = appels.find(a => a.url === '/api/receptions' && a.options?.method === 'POST')!;
    expect(envoi).toBeTruthy();
    const corps = JSON.parse(String(envoi.options!.body));
    expect(corps).toMatchObject({ project_id: 'p1', marche_id: 'm2', date_opr: '2026-11-12', date: '2026-11-12' });
    // Le régime n'est jamais envoyé : le serveur le déduit de l'affaire.
    expect(corps.regime).toBeUndefined();
  });
});

describe('PV signé', () => {
  it('s\'ouvre verrouillé : bandeau, champs désactivés, pas d\'enregistrement, réouverture possible', async () => {
    await monter();
    const ligneSignee = [...container.querySelectorAll('tbody tr')].find(l => l.textContent?.includes('OPR-2026-002'))!;
    await act(async () => ligneSignee.querySelector<HTMLButtonElement>('button')!.click());
    const dialogue = document.body.querySelector('[role="dialog"]')!;

    expect(dialogue.textContent).toContain('opr_signed_locked');
    expect(dialogue.querySelector('fieldset[disabled]')).toBeTruthy();
    expect(boutons('opr_save')).toHaveLength(0);
    expect(boutons('opr_reopen')).toHaveLength(1);

    await act(async () => boutons('opr_reopen')[0].click());
    await attendre();
    expect(appels.some(a => a.url === '/api/receptions/r2/signature/rouvrir' && a.options?.method === 'POST')).toBe(true);
  });
});
