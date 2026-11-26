import { describe, it, expect } from 'vitest';
import { appliquerMarge, avecMarge, margePatch, tauxMargeDe, vueMarge, TAUX_MARGE_MAX } from '../marge';
import { prixTotalPatch } from '../quantites';
import { totauxDocument } from '../../components/pro/selectionOps';
import { filtrerPourExport } from '../exportPerimetre';
import type { DPGF, Ligne } from '../../types/dpgf';

const ligne = (id: string, quantite: number, prixUnitaire: number, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: id, unite: 'u', quantite, prixUnitaire, prixTotal: quantite * prixUnitaire, type: 'ouvrage', ...extra,
});

const document = (lignes: Ligne[]): DPGF => ({
  id: 'd', projectId: 'p', titre: 'DPGF', version: '1', dateCreation: '2026-01-01', statut: 'draft', TVA: 20,
  totalHT: 0, totalTTC: 0,
  lots: [{ id: 'lot', numero: '01', titre: 'Gros oeuvre', sousTotal: 0, chapitres: [{ id: 'chap', numero: '1', titre: 'Dalles', lignes }] }],
});

describe('margePatch', () => {
  it('accepte un nombre, une virgule, un pourcentage et un calcul', () => {
    expect(margePatch({}, '15')).toEqual({ tauxMarge: 15 });
    expect(margePatch({}, '12,5')).toEqual({ tauxMarge: 12.5 });
    expect(margePatch({}, '12,5 %')).toEqual({ tauxMarge: 12.5 });
    expect(margePatch({}, '=10+2,5')).toEqual({ tauxMarge: 12.5 });
  });

  it('retire la marge quand la saisie est vide ou nulle', () => {
    expect(margePatch({}, '')).toEqual({ tauxMarge: undefined });
    expect(margePatch({}, '0')).toEqual({ tauxMarge: undefined });
  });

  it('refuse une saisie invalide, négative ou hors borne, sans rien changer', () => {
    expect(margePatch({}, 'abc')).toBeNull();
    expect(margePatch({}, '-5')).toBeNull();
    expect(margePatch({}, String(TAUX_MARGE_MAX + 1))).toBeNull();
  });

  it('refuse un article à sous-articles : la marge se pose sur les sous-articles', () => {
    expect(margePatch({ children: [ligne('a', 1, 1)] }, '10')).toBeNull();
  });
});

describe('tauxMargeDe', () => {
  it('ignore un taux absent, négatif ou illisible, et borne le plus haut', () => {
    expect(tauxMargeDe({})).toBe(0);
    expect(tauxMargeDe({ tauxMarge: -3 })).toBe(0);
    expect(tauxMargeDe({ tauxMarge: Number.NaN })).toBe(0);
    expect(tauxMargeDe({ tauxMarge: 5000 })).toBe(TAUX_MARGE_MAX);
  });
});

describe('appliquerMarge', () => {
  it('majore le prix unitaire et le total de chaque article de son taux', () => {
    const doc = appliquerMarge(document([ligne('a', 12, 80, { tauxMarge: 15 })]));
    const a = doc.lots[0].chapitres[0].lignes[0];
    expect(a.prixUnitaire).toBeCloseTo(92, 6);
    expect(a.prixTotal).toBe(1104);
  });

  it('recalcule le sous-total du lot et les totaux depuis les prix finaux', () => {
    const doc = appliquerMarge(document([ligne('a', 10, 100, { tauxMarge: 10 }), ligne('b', 1, 50)]));
    expect(doc.lots[0].sousTotal).toBe(1150);
    expect(doc.totalHT).toBe(1150);
    expect(doc.totalTTC).toBeCloseTo(1380, 6);
    expect(totauxDocument(doc.lots, doc.TVA).totalHT).toBe(1150);
  });

  it('ne touche ni l\'original ni les articles sans marge ou pour mémoire', () => {
    const original = document([ligne('a', 2, 10, { tauxMarge: 50 }), ligne('pm', 1, 0, { tauxMarge: 50, pourMemoire: true })]);
    const copie = appliquerMarge(original);
    expect(original.lots[0].chapitres[0].lignes[0].prixTotal).toBe(20);
    expect(copie.lots[0].chapitres[0].lignes[0].prixTotal).toBe(30);
    expect(copie.lots[0].chapitres[0].lignes[1].prixTotal).toBe(0);
  });

  it('descend dans les sous-articles et fait suivre le total du parent', () => {
    const parent = ligne('p', 0, 0, {
      prixTotal: 300,
      children: [ligne('p1', 1, 100, { tauxMarge: 10 }), ligne('p2', 2, 100, { tauxMarge: 20 })],
    });
    const doc = appliquerMarge(document([parent]));
    const p = doc.lots[0].chapitres[0].lignes[0];
    expect(p.children?.map(c => c.prixTotal)).toEqual([110, 240]);
    expect(p.prixTotal).toBe(350);
    expect(doc.lots[0].sousTotal).toBe(350);
  });

  it('garde la structure et les indices de l\'original', () => {
    const original = document([ligne('a', 1, 10), ligne('b', 1, 20, { tauxMarge: 25 })]);
    const copie = appliquerMarge(original);
    expect(copie.lots[0].chapitres[0].lignes.map(l => l.id)).toEqual(['a', 'b']);
  });

  it('rend le document tel quel quand aucun article n\'a de marge', () => {
    const original = document([ligne('a', 1, 10)]);
    expect(appliquerMarge(original)).toBe(original);
  });
});

describe('vueMarge', () => {
  it('rend l\'original sans marge demandée, la copie majorée sinon', () => {
    const original = document([ligne('a', 1, 100, { tauxMarge: 10 })]);
    expect(vueMarge(original, false)).toBe(original);
    expect(vueMarge(original, undefined)).toBe(original);
    expect(vueMarge(original, true).lots[0].chapitres[0].lignes[0].prixTotal).toBe(110);
  });
});

describe('avecMarge', () => {
  it('arrondit au centime', () => {
    expect(avecMarge(33.33, 12.5)).toBe(37.5);
    expect(avecMarge(100, 0)).toBe(100);
  });
});

describe('prixTotalPatch', () => {
  it('déduit le prix unitaire du total saisi et de la quantité, à la baisse comme à la hausse', () => {
    const l = ligne('a', 12, 80);
    expect(prixTotalPatch(l, '900')).toMatchObject({ prixTotal: 900, prixUnitaire: 75 });
    expect(prixTotalPatch(l, '1200')).toMatchObject({ prixTotal: 1200, prixUnitaire: 100 });
  });

  it('garde la précision du P.U. pour que quantité x P.U. redonne le total saisi', () => {
    const patch = prixTotalPatch(ligne('a', 3, 10), '1000');
    expect(patch?.prixTotal).toBe(1000);
    expect(Number(((patch?.prixUnitaire ?? 0) * 3).toFixed(6))).toBe(1000);
  });

  it('laisse le prix unitaire quand la quantité est nulle', () => {
    const patch = prixTotalPatch(ligne('a', 0, 80), '500');
    expect(patch).toEqual({ pourMemoire: undefined, prixTotal: 500 });
  });

  it('accepte un calcul, « PM » et ignore une saisie invalide ou un article à sous-articles', () => {
    expect(prixTotalPatch(ligne('a', 4, 1), '=100+50')).toMatchObject({ prixTotal: 150, prixUnitaire: 37.5 });
    expect(prixTotalPatch(ligne('a', 4, 1), 'PM')).toEqual({ pourMemoire: true, prixUnitaire: 0, prixTotal: 0 });
    expect(prixTotalPatch(ligne('a', 4, 1), 'abc')).toBeNull();
    expect(prixTotalPatch(ligne('a', 4, 1, { children: [ligne('b', 1, 1)] }), '10')).toBeNull();
  });
});

describe('export : le périmètre garde le taux de marge', () => {
  it('filtrerPourExport conserve tauxMarge, donc appliquerMarge majore bien le document exporté', () => {
    const original = document([ligne('a', 10, 100, { tauxMarge: 10 })]);
    const filtre = filtrerPourExport(original, { lotNumeros: ['01'], batimentCodes: null, phaseCodes: null });
    expect(vueMarge(filtre, true).totalHT).toBe(1100);
  });
});
