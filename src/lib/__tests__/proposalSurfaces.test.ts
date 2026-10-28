import { describe, it, expect } from 'vitest';
import {
  toSurface, operationNature, surfaceExistante, surfaceRehabilitee, surfaceDePlancher,
  coutTravauxParRatios, surfacesApresSaisieRehabilitation,
} from '../proposalSurfaces';

describe('toSurface', () => {
  it('lit les surfaces saisies à la française', () => {
    expect(toSurface('1 126,5')).toBe(1126.5);
    expect(toSurface('250')).toBe(250);
  });
  it('vaut 0 pour une valeur vide ou illisible', () => {
    expect(toSurface('')).toBe(0);
    expect(toSurface(undefined)).toBe(0);
    expect(toSurface('abc')).toBe(0);
  });
});

describe('operationNature', () => {
  it('suit le choix enregistré', () => {
    expect(operationNature({ operation_nature: 'neuf', type_projet: 'Réhabilitation' })).toBe('neuf');
    expect(operationNature({ operation_nature: 'rehabilitation' })).toBe('rehabilitation');
  });
  it('se déduit du type de projet des propositions antérieures', () => {
    expect(operationNature({ type_projet: 'Construction neuve' })).toBe('neuf');
    expect(operationNature({ type_projet: 'Réhabilitation' })).toBe('rehabilitation');
    expect(operationNature({ type_projet: 'Extension' })).toBe('rehabilitation');
  });
  it('se déduit des chiffres déjà saisis, à défaut du neuf', () => {
    expect(operationNature({ surface_plancher_ext: '40' })).toBe('rehabilitation');
    expect(operationNature({ ratio_rehab: 900 })).toBe('rehabilitation');
    expect(operationNature({})).toBe('neuf');
  });
});

describe('surface existante d\'une proposition antérieure', () => {
  it('relit surface_plancher comme surface existante en réhabilitation déduite', () => {
    const legacy = { surface_plancher: '120', surface_plancher_ext: '30', ratio_rehab: 1000, ratio_extension: 2000 };
    expect(surfaceExistante(legacy)).toBe('120');
    expect(coutTravauxParRatios(legacy)).toBe(120 * 1000 + 30 * 2000);
  });
  it('ne reprend pas surface_plancher une fois la nature choisie', () => {
    expect(surfaceExistante({ operation_nature: 'rehabilitation', surface_plancher: '120' })).toBe('');
  });
});

describe('neuf', () => {
  const neuf = { operation_nature: 'neuf', surface_plancher: '250', ratio_extension: 1780 };
  it('prend la surface de plancher saisie', () => {
    expect(surfaceDePlancher(neuf)).toBe(250);
  });
  it('calcule le coût avec le ratio de construction neuve', () => {
    expect(coutTravauxParRatios(neuf)).toBe(445000);
  });
  it('ignore les surfaces de réhabilitation restées saisies', () => {
    expect(coutTravauxParRatios({ ...neuf, surface_plancher_ext: '40', surface_existante: '99', ratio_rehab: 500 })).toBe(445000);
  });
});

describe('réhabilitation', () => {
  const rehab = {
    operation_nature: 'rehabilitation', surface_existante: '200', surface_rehabilitee: '150',
    surface_plancher_ext: '30', ratio_rehab: 1000, ratio_extension: 2000,
  };
  it('applique le ratio de réhabilitation à la surface réhabilitée, pas à toute l\'existante', () => {
    expect(surfaceRehabilitee(rehab)).toBe(150);
    expect(coutTravauxParRatios(rehab)).toBe(150 * 1000 + 30 * 2000);
  });
  it('prend toute l\'existante quand la surface réhabilitée n\'est pas saisie', () => {
    expect(coutTravauxParRatios({ ...rehab, surface_rehabilitee: '' })).toBe(200 * 1000 + 30 * 2000);
  });
  it('la surface de plancher est existante + extension', () => {
    expect(surfaceDePlancher(rehab)).toBe(230);
    expect(surfacesApresSaisieRehabilitation(rehab)).toEqual({ surface_plancher: '230' });
  });
  it('laisse la surface de plancher vide sans aucune surface', () => {
    expect(surfacesApresSaisieRehabilitation({ operation_nature: 'rehabilitation' })).toEqual({ surface_plancher: '' });
  });
});
