import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerGeoTravelRoutes, parseLonLat, haversineKm } from '../server/routes/geoTravel';

function makeApp() {
  const app = express();
  registerGeoTravelRoutes(app);
  return app;
}

const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

describe('geoTravel', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('parseLonLat refuse les coordonnées absentes ou hors limites', () => {
    expect(parseLonLat(undefined, '48')).toBeNull();
    expect(parseLonLat('200', '48')).toBeNull();
    expect(parseLonLat('6.17', 'abc')).toBeNull();
    expect(parseLonLat('6.17', '48.69')).toEqual({ lon: 6.17, lat: 48.69 });
  });

  it('haversineKm donne Nancy-Paris autour de 280 km', () => {
    const km = haversineKm({ lon: 6.18, lat: 48.69 }, { lon: 2.35, lat: 48.86 });
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(290);
  });

  it('route : rejette des coordonnées invalides', async () => {
    const res = await request(makeApp()).get('/api/geo/route?fromLon=x&fromLat=1&toLon=2&toLat=3');
    expect(res.status).toBe(400);
  });

  it('route : renvoie distance et durée du service', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ distance: 12.5, duration: 18, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } }), { status: 200 })));
    const res = await request(makeApp()).get('/api/geo/route?fromLon=6.1&fromLat=48.6&toLon=6.2&toLat=48.7');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ distanceKm: 12.5, durationMinutes: 18, approximate: false });
  });

  it('route : se rabat sur la distance à vol d\'oiseau si le service échoue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const res = await request(makeApp()).get('/api/geo/route?fromLon=3.1&fromLat=45.6&toLon=3.2&toLat=45.7');
    expect(res.status).toBe(200);
    expect(res.body.approximate).toBe(true);
    expect(res.body.durationMinutes).toBeNull();
    expect(res.body.distanceKm).toBeGreaterThan(0);
  });

  it('isochrones : garde les durées obtenues et liste celles qui échouent', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 4
      ? new Response('', { status: 400 })
      : new Response(JSON.stringify({ geometry: polygon }), { status: 200 }))));
    const res = await request(makeApp()).get('/api/geo/isochrones?lon=7.1&lat=48.1');
    expect(res.status).toBe(200);
    expect(res.body.isochrones).toHaveLength(3);
    expect(res.body.failed).toHaveLength(1);
  });

  it('isochrones : 502 quand aucune durée n\'est obtenue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const res = await request(makeApp()).get('/api/geo/isochrones?lon=8.1&lat=47.1');
    expect(res.status).toBe(502);
  });

  it('geocode : 404 quand aucune adresse n\'est trouvée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 })));
    const res = await request(makeApp()).get('/api/geo/geocode?q=zzzzzz introuvable');
    expect(res.status).toBe(404);
  });
});
