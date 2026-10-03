import { describe, it, expect } from 'vitest';
import { toggleParcel, summarizeParcels, selectionGeometry, parcelReference, formatSurface } from '../cadastreSelection';

const square = (x: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]],
});

const a = { id: 'A', section: 'AB', numero: '0123', prefixe: '000', contenance: 300, geometry: square(0) };
const b = { id: 'B', section: 'AB', numero: '0124', prefixe: '000', contenance: 518, geometry: square(1) };

describe('cadastreSelection', () => {
  it('ajoute puis retire une parcelle au clic', () => {
    const once = toggleParcel([], a);
    expect(once.map((p) => p.id)).toEqual(['A']);
    expect(toggleParcel([...once, b], a).map((p) => p.id)).toEqual(['B']);
  });

  it('omet le préfixe 000 de la référence', () => {
    expect(parcelReference(a)).toBe('AB 0123');
    expect(parcelReference({ ...a, prefixe: '012' })).toBe('012 AB 0123');
  });

  it('cumule les contenances et joint les références', () => {
    expect(summarizeParcels([a, b])).toEqual({ reference: 'AB 0123, AB 0124', surface: 818 });
  });

  it('ne donne pas de total partiel quand une contenance manque', () => {
    expect(summarizeParcels([a, { ...b, contenance: undefined }]).surface).toBeNull();
    expect(summarizeParcels([]).surface).toBeNull();
  });

  it('fusionne les géométries en MultiPolygon', () => {
    expect(selectionGeometry([])).toBeNull();
    expect(selectionGeometry([a])?.type).toBe('Polygon');
    const multi = selectionGeometry([a, b]) as GeoJSON.MultiPolygon;
    expect(multi.type).toBe('MultiPolygon');
    expect(multi.coordinates).toHaveLength(2);
  });

  it('formate la surface sans espace fine insécable', () => {
    expect(formatSurface(1818)).toBe('1 818 m²');
  });
});
