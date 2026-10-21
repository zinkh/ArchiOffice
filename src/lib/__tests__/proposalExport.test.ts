import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatCurrency, formatPercent, buildDefaultTemplate, loadStoredTemplate,
  mapProposalToPdfData, planifierCalendrier, DENSITY_TOKENS, TABLE_DENSITY_OPTIONS,
} from '../proposalExport';
import type { Proposal } from '../../types';

// L'enregistrement automatique charge le client Supabase, qui exige l'environnement du navigateur.
vi.mock('../autoSaveDocument', () => ({ autoSaveDocument: vi.fn() }));

function fakeLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
}

describe('formatCurrency / formatPercent', () => {
  // Ces espaces s'impriment « / » (U+202F) ou sans largeur (U+00A0) avec la police du PDF.
  const PROBLEMATIC = /[  ]/;

  it("n'emploie que des espaces ordinaires", () => {
    expect(formatCurrency(46000)).not.toMatch(PROBLEMATIC);
    expect(formatCurrency(1234567.5)).not.toMatch(PROBLEMATIC);
    expect(formatPercent(12.5)).not.toMatch(PROBLEMATIC);
  });

  it('garde le séparateur de milliers, la virgule décimale et le symbole', () => {
    expect(formatCurrency(46000)).toBe('46 000,00 €');
    expect(formatCurrency(9200)).toBe('9 200,00 €');
    expect(formatPercent(100)).toBe('100,00 %');
    expect(formatPercent(7.5)).toBe('7,50 %');
  });

  it('traite une valeur absente comme zéro', () => {
    expect(formatCurrency(Number.NaN)).toBe('0,00 €');
    expect(formatPercent(undefined as unknown as number)).toBe('0,00 %');
  });
});

describe('modèle : réglages de mise en page', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeLocalStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("garde les sauts de page d'origine et compacte les tableaux par défaut", () => {
    const { layout } = buildDefaultTemplate();
    expect(layout).toEqual({ sectionBreaks: true, tableDensity: 'compact', cotraitantIdentity: true });
  });

  it('complète un modèle déjà enregistré qui ne connaît pas encore les réglages', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage({
      proposalTemplate: JSON.stringify({ detailLevel: 'court', visual: { primaryColor: '#123456' } }),
    }));
    const template = loadStoredTemplate();
    expect(template.visual.primaryColor).toBe('#123456');
    expect(template.layout).toEqual(buildDefaultTemplate().layout);
  });

  it('respecte les réglages enregistrés et complète seulement ceux qui manquent', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage({
      proposalTemplate: JSON.stringify({ layout: { sectionBreaks: false } }),
    }));
    expect(loadStoredTemplate().layout).toEqual({ sectionBreaks: false, tableDensity: 'compact', cotraitantIdentity: true });
  });

  it('rend un modèle par défaut si le stockage est illisible', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage({ proposalTemplate: '{pas du json' }));
    expect(loadStoredTemplate().layout).toEqual(buildDefaultTemplate().layout);
  });
});

describe('densité des tableaux', () => {
  it('propose chaque densité définie, et seulement celles-là', () => {
    expect(TABLE_DENSITY_OPTIONS.map(o => o.value).sort()).toEqual(Object.keys(DENSITY_TOKENS).sort());
  });

  it('prend de moins en moins de place de la normale à la très compacte', () => {
    // Marges « haut côtés bas » en mm : on compare haut + bas.
    const hauteurMarges = (padding: string) => {
      const [haut, , bas = haut] = padding.split(' ').map(parseFloat);
      return haut + bas;
    };
    const { normal, compact, dense } = DENSITY_TOKENS;
    expect(hauteurMarges(compact.cellPadding)).toBeLessThan(hauteurMarges(normal.cellPadding));
    expect(hauteurMarges(dense.cellPadding)).toBeLessThan(hauteurMarges(compact.cellPadding));
    expect(parseFloat(dense.cellFont)).toBeLessThan(parseFloat(normal.cellFont));
    expect(dense.cellLineHeight).toBeLessThan(normal.cellLineHeight);
  });
});

describe('planifierCalendrier', () => {
  const liste = (...noms: Array<[string, string]>) => noms.map(([id, designation]) => ({ id, designation }));
  // Les identifiants de la répartition d'honoraires par défaut.
  const standard = liste(
    ['esquisse', 'Esquisse'], ['aps', 'A.P.S.'], ['apd', 'A.P.D.'], ['projet', 'Projet'], ['act', 'A.C.T.'],
    ['visa', 'VISA'], ['det', 'D.E.T.'], ['aor', 'A.O.R.'], ['opc', 'OPC'],
  );
  const par = (items: ReturnType<typeof planifierCalendrier>, id: string) => items.find(i => i.id === 'c_' + id)!;

  it('enchaîne les phases : chacune démarre quand la précédente finit', () => {
    const items = planifierCalendrier(standard);
    expect(par(items, 'esquisse')).toMatchObject({ debutJours: 0, apres: '' });
    expect(par(items, 'aps')).toMatchObject({ debutJours: 15, apres: 'c_esquisse' });
    expect(par(items, 'apd')).toMatchObject({ debutJours: 30, apres: 'c_aps' });
    expect(par(items, 'act')).toMatchObject({ debutJours: 60, apres: 'c_projet' });
  });

  it("la DET suit l'ACT et l'AOR suit la DET, sans passer par le VISA ni l'OPC", () => {
    const items = planifierCalendrier(standard);
    expect(par(items, 'det')).toMatchObject({ debutJours: 75, apres: 'c_act' });
    expect(par(items, 'aor')).toMatchObject({ debutJours: 90, apres: 'c_det' });
  });

  it('le VISA démarre en même temps que la DET', () => {
    const visa = par(planifierCalendrier(standard), 'visa');
    expect(visa).toMatchObject({ debutJours: 75, apres: '', avec: ['c_det'] });
  });

  it("l'OPC court en parallèle de la DET et de l'AOR, du début de l'une à la fin de l'autre", () => {
    const items = planifierCalendrier(standard);
    const aor = par(items, 'aor');
    const opc = par(items, 'opc');
    expect(opc.debutJours).toBe(par(items, 'det').debutJours);
    expect(opc.debutJours + opc.dureeJours).toBe(aor.debutJours + aor.dureeJours);
    expect(opc.avec).toEqual(['c_det', 'c_aor']);
  });

  it("mène l'EXE en parallèle de la DET", () => {
    const items = planifierCalendrier(liste(['pro', 'Projet'], ['exe', 'EXE'], ['det', 'D.E.T.'], ['aor', 'A.O.R.']));
    expect(par(items, 'exe')).toMatchObject({ debutJours: 15, avec: ['c_det'] });
    expect(par(items, 'det')).toMatchObject({ debutJours: 15, apres: 'c_pro' });
  });

  it('reconnaît une phase renommée par son sigle ou son intitulé', () => {
    const items = planifierCalendrier(liste(
      ['m1', 'Dossier de permis'], ['m2', "Direction de l'exécution des travaux (DET)"],
      ['m3', 'Visa des études'], ['m4', 'Assistance aux opérations de réception (AOR)'],
    ));
    expect(par(items, 'm3')).toMatchObject({ debutJours: 15, avec: ['c_m2'] });
    expect(par(items, 'm4')).toMatchObject({ debutJours: 30, apres: 'c_m2' });
  });

  it('enchaîne tout quand il n\'y a pas de DET : rien ne peut être parallèle', () => {
    const items = planifierCalendrier(liste(['esquisse', 'Esquisse'], ['visa', 'VISA'], ['opc', 'OPC']));
    expect(items.map(i => i.debutJours)).toEqual([0, 15, 30]);
    expect(items.every(i => i.avec.length === 0)).toBe(true);
  });

  it('rend un calendrier vide sans mission', () => {
    expect(planifierCalendrier([])).toEqual([]);
  });
});

describe('mapProposalToPdfData : cotraitants', () => {
  const proposal = {
    id: 'p1', title: 'Cabinet', client_id: 'c', amount: 1000, status: 'Draft', description: '', created_at: '2026-01-01',
    specialties_list: [
      { id: 's1', proposal_id: 'p1', specialty_name: 'Structure', contact_id: 'c-bet', contact_name: 'BET' },
      { id: 's2', proposal_id: 'p1', specialty_name: 'Acoustique' },
    ],
  } as Proposal;

  it("garde l'identifiant de la fiche contact pour retrouver l'identité du cotraitant", () => {
    const { cotraitants } = mapProposalToPdfData(proposal, {});
    expect(cotraitants[0]).toMatchObject({ specialite: 'Structure', contact: 'BET', contactId: 'c-bet' });
  });

  it("laisse sans identifiant un cotraitant qui n'a pas de fiche", () => {
    const { cotraitants } = mapProposalToPdfData(proposal, {});
    expect(cotraitants[1].contactId).toBeUndefined();
    expect(cotraitants[1].contact).toBe('');
  });
});
