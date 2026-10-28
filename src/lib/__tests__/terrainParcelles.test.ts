import { describe, it, expect } from 'vitest';
import {
  serializeParcels, parseStoredParcels, sameParcelIds, totalSurface, parcelCentroid, sameAddress,
  MAX_STORED_PARCELS,
} from '../terrainParcelles';

const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[6.0, 48.0], [6.2, 48.0], [6.2, 48.2], [6.0, 48.2], [6.0, 48.0]]],
};

const parcel = (id: string, contenance?: number) => ({
  id, section: 'AB', numero: id.slice(-4), prefixe: '000', commune: 'Exemple', insee: '54547',
  ...(contenance != null ? { contenance } : {}), geometry: square,
});

describe('parseStoredParcels', () => {
  it('relit ce que serializeParcels a écrit', () => {
    const parcels = [parcel('54547000AB0123', 818), parcel('54547000AB0124', 400)];
    expect(parseStoredParcels(serializeParcels(parcels))).toEqual(parcels);
  });

  it('rend une sélection vide pour une valeur absente, vide ou corrompue', () => {
    expect(parseStoredParcels(undefined)).toEqual([]);
    expect(parseStoredParcels(null)).toEqual([]);
    expect(parseStoredParcels('')).toEqual([]);
    expect(parseStoredParcels('{pas du json')).toEqual([]);
    expect(parseStoredParcels('{"a":1}')).toEqual([]);
  });

  it('écarte les éléments sans identifiant et les géométries qui ne sont pas des polygones', () => {
    const raw = JSON.stringify([
      { section: 'AB' },
      'texte',
      { id: 'p1', section: 'AB', numero: 12, geometry: { type: 'Point', coordinates: [1, 2] } },
    ]);
    const out = parseStoredParcels(raw);
    expect(out).toHaveLength(1);
    expect(out[0].numero).toBe('12');
    expect(out[0].geometry).toBeUndefined();
  });

  it('borne le nombre de parcelles relues', () => {
    const many = Array.from({ length: MAX_STORED_PARCELS + 10 }, (_, i) => ({ id: `p${i}` }));
    expect(parseStoredParcels(many)).toHaveLength(MAX_STORED_PARCELS);
  });
});

describe('totalSurface', () => {
  it('additionne les contenances', () => {
    expect(totalSurface([parcel('a', 818), parcel('b', 400)])).toEqual({ total: 1218, complete: true });
  });

  it('signale un total partiel dès qu\'une contenance manque', () => {
    expect(totalSurface([parcel('a', 818), parcel('b')])).toEqual({ total: 818, complete: false });
  });

  it('vaut zéro, complet, sans parcelle', () => {
    expect(totalSurface([])).toEqual({ total: 0, complete: true });
  });
});

describe('sameParcelIds', () => {
  it('compare les identifiants dans l\'ordre', () => {
    expect(sameParcelIds([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])).toBe(true);
    expect(sameParcelIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }])).toBe(false);
    expect(sameParcelIds([{ id: 'a' }], [])).toBe(false);
  });
});

describe('parcelCentroid', () => {
  it('rend le centre d\'un carré', () => {
    const c = parcelCentroid(square)!;
    expect(c[0]).toBeCloseTo(6.1, 6);
    expect(c[1]).toBeCloseTo(48.1, 6);
  });

  it('choisit le plus grand polygone d\'un MultiPolygon', () => {
    const small: GeoJSON.Position[][] = [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]];
    const c = parcelCentroid({ type: 'MultiPolygon', coordinates: [small, square.coordinates] })!;
    expect(c[0]).toBeCloseTo(6.1, 6);
  });

  it('rend null sans géométrie exploitable', () => {
    expect(parcelCentroid(undefined)).toBeNull();
    expect(parcelCentroid({ type: 'Point', coordinates: [1, 2] })).toBeNull();
  });
});

describe('sameAddress', () => {
  it('ignore la casse, les accents et la ponctuation', () => {
    expect(sameAddress('12 Rue de l\'Église, 54500 Vandoeuvre', '12 rue de l eglise 54500 vandoeuvre')).toBe(true);
  });

  it('distingue deux adresses différentes', () => {
    expect(sameAddress('12 rue des Lilas 54500', '14 rue des Lilas 54500')).toBe(false);
  });

  it('traite vide et absent comme identiques', () => {
    expect(sameAddress('', undefined)).toBe(true);
  });
});
