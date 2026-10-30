// @vitest-environment jsdom
// Liste et formulaire des PV d'OPR (onglet AOR) : lignes, avertissement en marché public, création
// d'un PV, PV signé verrouillé. L'API est simulée ; les textes s'affichent sous leur clé.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const telechargements: Array<{ blob: Blob; nom: string }> = [];
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, nom: string) => { telechargements.push({ blob, nom }); } }));

const appels: Array<{ url: string; options?: RequestInit }> = [];
const receptions = [
  { id: 'r1', project_id: 'p1', regime: 'prive', marche_id: 'm1', reference_pv: 'OPR-2026-001', date_opr: '2026-11-03', proposition: { avis: 'sans_reserve' }, signed_at: null },
  { id: 'r2', project_id: 'p1', regime: 'prive', marche_id: 'm2', reference_pv: 'OPR-2026-002', date_opr: '2026-10-20', signed_at: '2026-11-10', signed_mode: 'papier' },
  { id: 'r-generique', project_id: 'p1', regime: null, date: '2026-01-01', type: 'OPR' },
  { id: 'r-public', project_id: 'p1', regime: 'public', marche_id: 'm1', reference_pv: 'OPR-2026-003', date_opr: '2026-11-05', ccag_version: '2021', lieu: 'Nancy', public_info: { portee: 'totale', signataire: 'K. Sektaoui' } },
  {
    id: 'r-public-recu', project_id: 'p1', regime: 'public', marche_id: 'm2', reference_pv: 'OPR-2026-004', date_opr: '2026-10-01', ccag_version: '2021',
    proposition: { avis: 'avec_reserve', conditions: [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '1' }] },
    decision: { issue: 'avec_reserve', date_decision: '2026-10-20', conditions: [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '1' }] },
  },
  { id: 'r-public-refus', project_id: 'p1', regime: 'public', marche_id: 'm1', reference_pv: 'OPR-2026-005', date_opr: '2026-09-01', proposition: { avis: 'non_reception' }, decision: { issue: 'non_receptionnee' } },
];
const marches = [
  { id: 'm1', lot_numero: '01', lot_titre: 'Gros œuvre', entreprise_nom: 'BTS', type_marche: 'marche' },
  { id: 'm2', lot_numero: '02', lot_titre: 'Couverture', entreprise_nom: 'Toitures SA', type_marche: 'marche' },
  { id: 'm-cadre', lot_numero: '03', lot_titre: 'Accord-cadre', entreprise_nom: 'Cadre', type_marche: 'accord_cadre' },
];
const reserves = [
  { id: 'x1', reception_id: 'r1', number: 1, batiment: null, local: 'Hall', title: 'Peinture', status: 'A faire', created_at: '2026-11-03', nature: null },
  { id: 'x2', reception_id: 'r-public-recu', number: 2, batiment: null, local: 'Façade', title: 'Enduit', status: 'A faire', created_at: '2026-10-01', nature: 'malfacons' },
];

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

beforeEach(() => { appels.length = 0; telechargements.length = 0; });
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

  it('en marché public : avertissement sur EXE6 à EXE9, et seuls les PV publics sont listés', async () => {
    await monter(true);
    expect(container.textContent).toContain('opr_public_notice');
    const lignes = [...container.querySelectorAll('tbody tr')];
    expect(lignes).toHaveLength(3);
    expect(lignes.map(l => l.textContent).join(' ')).toContain('OPR-2026-003');
    // L'export rapide du modèle simplifié n'existe pas en public : les cerfas se téléchargent depuis le formulaire.
    expect(lignes[0].querySelector('button[aria-label^="opr_pdf"]')).toBeNull();
  });
});

describe('PV public (EXE4, EXE5)', () => {
  const ouvrir = async (reference: string) => {
    const ligne = [...container.querySelectorAll('tbody tr')].find(l => l.textContent?.includes(reference))!;
    await act(async () => ligne.querySelector<HTMLButtonElement>('button')!.click());
    return document.body.querySelector('[role="dialog"]')!;
  };
  const formulaires = (dialogue: Element) =>
    [...dialogue.querySelectorAll('li')].map(l => l.textContent ?? '').filter(t => t.includes('opr_form_')).map(t => t.slice(0, 4));

  it('le formulaire porte les champs du cerfa et les décisions, sans saisie de réserves', async () => {
    await monter(true);
    const dialogue = await ouvrir('OPR-2026-003');
    const texte = dialogue.textContent ?? '';
    for (const cle of ['opr_ccag', 'opr_market_reference', 'opr_signatory', 'opr_place', 'opr_scope', 'opr_c_pose_equipements', 'opr_avis_sous_reserve_public', 'opr_avis_avec_reserve_public', 'opr_section_c', 'opr_date_effet', 'opr_reserves_from_list']) {
      expect(texte).toContain(cle);
    }
    // Les réserves ne se saisissent plus dans le PV : elles viennent de la liste des réserves.
    for (const cle of ['opr_reserve_add', 'opr_reserve_points', 'opr_reserve_building', 'opr_reserve_remove']) {
      expect(texte).not.toContain(cle);
    }
    // Sans proposition ni décision : seuls EXE4 et EXE5 sont à produire.
    expect(formulaires(dialogue)).toEqual(['EXE4', 'EXE5']);
    // Pas de levée des réserves tant que la réception n'est pas prononcée avec des réserves.
    expect(texte).not.toContain('opr_section_levee');
    // Les champs enregistrés sont repris.
    expect((dialogue.querySelector('select option[value="2021"]')!.parentElement as HTMLSelectElement).value).toBe('2021');
  });

  it('une réception avec réserves ouvre la levée des réserves et la chaîne EXE4, EXE5, EXE6, EXE8, EXE9', async () => {
    await monter(true);
    const dialogue = await ouvrir('OPR-2026-004');
    const texte = dialogue.textContent ?? '';
    expect(texte).toContain('opr_section_levee');
    expect(texte).toContain('opr_levee_opt_lever_partie');
    expect(texte).toContain('opr_refaction_letter');
    expect(formulaires(dialogue)).toEqual(['EXE4', 'EXE5', 'EXE6', 'EXE8', 'EXE9']);
    // La nature d'une réserve déjà enregistrée se lit et se corrige sans rouvrir le PV.
    const natures = [...dialogue.querySelectorAll<HTMLSelectElement>('select[aria-label="opr_reserve_nature"]')];
    expect(natures).toHaveLength(1);
    expect(natures[0].value).toBe('malfacons');
    await remplir(natures[0], 'travaux');
    await attendre();
    const appel = appels.find(a => a.url === '/api/reserves/x2/nature')!;
    expect(appel.options?.method).toBe('PUT');
    expect(JSON.parse(String(appel.options!.body))).toEqual({ nature: 'travaux' });
  });

  it('une non-réception produit EXE7 et aucune levée', async () => {
    await monter(true);
    const dialogue = await ouvrir('OPR-2026-005');
    expect(formulaires(dialogue)).toEqual(['EXE4', 'EXE5', 'EXE7']);
    expect(dialogue.textContent).not.toContain('opr_section_levee');
  });

  it('enregistre le CCAG, les mentions du public et le lieu, sans jamais envoyer le régime', async () => {
    await monter(true);
    await act(async () => boutons('opr_new')[0].click());
    const dialogue = document.body.querySelector('[role="dialog"]')!;
    const selects = [...dialogue.querySelectorAll('select')];
    await remplir(selects[0], 'm1');
    const ccag = selects.find(sel => [...sel.options].some(o => o.value === '2009'))!;
    await remplir(ccag, '2009');
    const champs = [...dialogue.querySelectorAll<HTMLInputElement>('input[maxlength]')];
    await remplir(champs.find(c => c.maxLength === 64)!, 'M-2026-01');
    await act(async () => boutons('opr_save')[0].click());
    await attendre();
    const envoi = appels.find(a => a.url === '/api/receptions' && a.options?.method === 'POST')!;
    const corps = JSON.parse(String(envoi.options!.body));
    expect(corps).toMatchObject({ marche_id: 'm1', ccag_version: '2009', public_info: { reference_marche: 'M-2026-01' } });
    expect(corps.regime).toBeUndefined();
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

describe('export groupé', () => {
  it('en public : un PDF par formulaire et par lot, remis dans un ZIP', async () => {
    await monter(true);
    await act(async () => boutons('opr_export_all')[0].click());
    await act(async () => { await new Promise(r => setTimeout(r, 1500)); });
    expect(telechargements).toHaveLength(1);
    const { blob, nom } = telechargements[0];
    expect(nom).toMatch(/\.zip$/);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const fichiers = Object.keys(zip.files).sort();
    // OPR-2026-003 : EXE4, EXE5 ; OPR-2026-004 : EXE4, EXE5, EXE6, EXE8, EXE9 ; OPR-2026-005 : EXE4, EXE5, EXE7.
    expect(fichiers).toHaveLength(10);
    expect(fichiers.filter(f => f.startsWith('EXE4'))).toHaveLength(3);
    expect(fichiers.filter(f => f.startsWith('EXE6') || f.startsWith('EXE8') || f.startsWith('EXE9') || f.startsWith('EXE7'))).toHaveLength(4);
    expect(fichiers.every(f => f.endsWith('.pdf'))).toBe(true);
    const premier = new Uint8Array(await zip.files[fichiers[0]].async('uint8array'));
    expect(String.fromCharCode(...premier.slice(0, 5))).toBe('%PDF-');
  });

  it('en privé : le PV simplifié de chaque lot', async () => {
    await monter(false);
    await act(async () => boutons('opr_export_all')[0].click());
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await telechargements[0].blob.arrayBuffer());
    expect(Object.keys(zip.files)).toHaveLength(2);
    expect(Object.keys(zip.files).every(f => f.startsWith('PV_OPR'))).toBe(true);
  });
});
