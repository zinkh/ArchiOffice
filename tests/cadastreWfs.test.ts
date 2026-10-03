import { describe, it, expect } from 'vitest';
import { buildCadastreWfsUrl, envelopeOf, normalizeAxisOrder, type Envelope } from '../server/cadastreWfs';

const env: Envelope = [6.49, 48.58, 6.50, 48.59];
const ring = [[6.495, 48.585], [6.496, 48.585], [6.496, 48.586], [6.495, 48.585]];

describe('cadastreWfs', () => {
  it('donne la BBOX en latitude, longitude (WFS 2.0, EPSG:4326)', () => {
    const url = new URL(buildCadastreWfsUrl(env));
    expect(url.searchParams.get('BBOX')).toBe('48.58,6.49,48.59,6.5,urn:ogc:def:crs:EPSG::4326');
    expect(url.searchParams.get('TYPENAMES')).toBe('CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle');
  });

  it("calcule l'emprise d'un polygone et élargit un point", () => {
    expect(envelopeOf({ type: 'Polygon', coordinates: [ring] })).toEqual([6.495, 48.585, 6.496, 48.586]);
    const [minLon, , maxLon] = envelopeOf({ type: 'Point', coordinates: [6.5, 48.6] }, 0.0001);
    expect(maxLon - minLon).toBeCloseTo(0.0002);
  });

  it('laisse intacte une réponse déjà en longitude, latitude', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
    expect(normalizeAxisOrder(fc, env).features[0].geometry.coordinates[0][0]).toEqual([6.495, 48.585]);
  });

  it('inverse une réponse arrivée en latitude, longitude', () => {
    const swapped = ring.map(([x, y]) => [y, x]);
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[swapped]] } }] };
    expect(normalizeAxisOrder(fc, env).features[0].geometry.coordinates[0][0][1]).toEqual([6.496, 48.585]);
  });

  it('accepte une collection vide', () => {
    expect(normalizeAxisOrder({ features: [] }, env)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
