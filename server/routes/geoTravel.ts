// Trajet et isochrones routiers, pour la carte du site de chantier d'un appel
// d'offres (src/components/TenderSiteMap.tsx). Relais sans état vers les services
// publics de la Géoplateforme de l'IGN (géocodage, calcul d'itinéraire, isochrones) :
// aucune clé, aucune donnée du cabinet n'est envoyée en dehors d'une adresse ou
// de coordonnées. Rien n'est lu ni écrit en base.
import type { Express } from 'express';
import { fetchWithTimeout } from '../fetchWithTimeout';

const GEOPF = 'https://data.geopf.fr';
const TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 200;

/** Durées des isochrones affichées : 30 min, 1 h, 1 h 30, 2 h (en secondes). */
export const ISOCHRONE_SECONDS = [1800, 3600, 5400, 7200] as const;

const cache = new Map<string, { expiresAt: number; data: unknown }>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { cache.delete(key); return null; }
  return hit.data as T;
}

function cacheSet(key: string, data: unknown): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

/** Longitude et latitude lues dans la requête, ou null si absentes ou hors limites. */
export function parseLonLat(lon: unknown, lat: unknown): { lon: number; lat: number } | null {
  if (lon === undefined || lon === '' || lat === undefined || lat === '') return null;
  const x = Number(lon);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) return null;
  return { lon: x, lat: y };
}

/** Distance à vol d'oiseau en kilomètres, repli quand le calcul d'itinéraire échoue. */
export function haversineKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function getJson(url: string): Promise<any> {
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, TIMEOUT_MS);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Une isochrone au format GeoJSON, ou null quand le service ne la fournit pas. */
export async function fetchIsochrone(point: { lon: number; lat: number }, seconds: number): Promise<GeoJSON.Geometry | null> {
  const url = `${GEOPF}/navigation/isochrone?point=${point.lon},${point.lat}`
    + `&resource=bdtopo-valhalla&costType=time&costValue=${seconds}&profile=car`
    + `&timeUnit=second&direction=departure&geometryFormat=geojson`;
  const data = await getJson(url);
  const geometry = data?.geometry;
  return geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') ? geometry : null;
}

export function registerGeoTravelRoutes(app: Express) {
  // Première adresse trouvée pour un texte (adresse du cabinet, adresse du site).
  app.get('/api/geo/geocode', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 3 || q.length > 300) return res.status(400).json({ error: 'Adresse invalide' });
      const key = `geocode:${q.toLowerCase()}`;
      const cached = cacheGet<object>(key);
      if (cached) return res.json(cached);
      const data = await getJson(`${GEOPF}/geocodage/search/?q=${encodeURIComponent(q)}&limit=1`);
      const feature = data?.features?.[0];
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
        return res.status(404).json({ error: 'Adresse introuvable' });
      }
      const result = { lon: coords[0], lat: coords[1], label: String(feature.properties?.label ?? q) };
      cacheSet(key, result);
      res.json(result);
    } catch (error: any) {
      console.error('[GeoTravel] geocode', error?.message);
      res.status(502).json({ error: 'Service de géocodage indisponible' });
    }
  });

  // Distance et durée par la route entre deux points ; à défaut, distance à vol d'oiseau.
  app.get('/api/geo/route', async (req, res) => {
    const from = parseLonLat(req.query.fromLon, req.query.fromLat);
    const to = parseLonLat(req.query.toLon, req.query.toLat);
    if (!from || !to) return res.status(400).json({ error: 'Coordonnées invalides' });
    const key = `route:${from.lon.toFixed(5)},${from.lat.toFixed(5)}:${to.lon.toFixed(5)},${to.lat.toFixed(5)}`;
    const cached = cacheGet<object>(key);
    if (cached) return res.json(cached);
    try {
      const data = await getJson(`${GEOPF}/navigation/itineraire?resource=bdtopo-osrm`
        + `&start=${from.lon},${from.lat}&end=${to.lon},${to.lat}&profile=car&optimization=fastest`
        + `&geometryFormat=geojson&getSteps=false&distanceUnit=kilometer&timeUnit=minute`);
      const distanceKm = Number(data?.distance);
      const durationMinutes = Number(data?.duration);
      if (!Number.isFinite(distanceKm) || !Number.isFinite(durationMinutes)) throw new Error('Réponse inattendue');
      const result = { distanceKm, durationMinutes, geometry: data?.geometry ?? null, approximate: false };
      cacheSet(key, result);
      res.json(result);
    } catch (error: any) {
      console.error('[GeoTravel] route', error?.message);
      res.json({ distanceKm: haversineKm(from, to), durationMinutes: null, geometry: null, approximate: true });
    }
  });

  // Isochrones de 30 min, 1 h, 1 h 30 et 2 h autour d'un point. Une durée que le service
  // refuse n'empêche pas les autres : elle est listée dans `failed`.
  app.get('/api/geo/isochrones', async (req, res) => {
    const point = parseLonLat(req.query.lon, req.query.lat);
    if (!point) return res.status(400).json({ error: 'Coordonnées invalides' });
    const key = `iso:${point.lon.toFixed(4)},${point.lat.toFixed(4)}`;
    const cached = cacheGet<object>(key);
    if (cached) return res.json(cached);
    const settled = await Promise.allSettled(ISOCHRONE_SECONDS.map(s => fetchIsochrone(point, s)));
    const isochrones: { seconds: number; geometry: GeoJSON.Geometry }[] = [];
    const failed: number[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) isochrones.push({ seconds: ISOCHRONE_SECONDS[i], geometry: r.value });
      else failed.push(ISOCHRONE_SECONDS[i]);
    });
    if (isochrones.length === 0) {
      console.error('[GeoTravel] isochrones: aucune durée obtenue');
      return res.status(502).json({ error: 'Service d\'isochrones indisponible' });
    }
    const result = { isochrones, failed };
    if (failed.length === 0) cacheSet(key, result);
    res.json(result);
  });
}
