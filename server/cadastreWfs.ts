// Source de secours des parcelles vectorielles : le WFS de la Géoplateforme
// IGN (PCI Express), le même jeu de données que le calque raster
// CADASTRALPARCELS déjà affiché sous la carte. APICARTO, la source
// principale, expire régulièrement ; sans ce relais, la carte n'avait plus
// que le raster, qui n'est pas cliquable.
import { fetchWithTimeout } from './fetchWithTimeout';

export type Envelope = [minLon: number, minLat: number, maxLon: number, maxLat: number];

const WFS_ENDPOINT = 'https://data.geopf.fr/wfs/ows';
const WFS_LAYER = 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle';
const WFS_MAX_FEATURES = 1000;

export function buildCadastreWfsUrl([minLon, minLat, maxLon, maxLat]: Envelope): string {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: WFS_LAYER,
    OUTPUTFORMAT: 'application/json',
    COUNT: String(WFS_MAX_FEATURES),
    SRSNAME: 'EPSG:4326',
    // WFS 2.0 : EPSG:4326 se donne en latitude, longitude.
    BBOX: `${minLat},${minLon},${maxLat},${maxLon},urn:ogc:def:crs:EPSG::4326`,
  });
  return `${WFS_ENDPOINT}?${params.toString()}`;
}

/** Emprise d'une géométrie Point/Polygon, élargie de `marginDeg` (utile pour un point). */
export function envelopeOf(geometry: { type: string; coordinates: any }, marginDeg = 0): Envelope {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visit = (c: any): void => {
    if (typeof c[0] === 'number') {
      minLon = Math.min(minLon, c[0]); maxLon = Math.max(maxLon, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  return [minLon - marginDeg, minLat - marginDeg, maxLon + marginDeg, maxLat + marginDeg];
}

const swapPositions = (c: any): any =>
  typeof c[0] === 'number' ? [c[1], c[0], ...c.slice(2)] : c.map(swapPositions);

const firstPosition = (c: any): number[] | null =>
  !Array.isArray(c) ? null : typeof c[0] === 'number' ? c : firstPosition(c[0]);

/**
 * Remet les coordonnées en longitude, latitude (ordre GeoJSON). Selon la
 * version du serveur, une sortie EPSG:4326 peut arriver en latitude,
 * longitude ; on le repère sur le premier sommet, qui doit tomber dans
 * l'emprise demandée.
 */
export function normalizeAxisOrder(collection: any, [minLon, minLat, maxLon, maxLat]: Envelope): any {
  const features: any[] = collection?.features ?? [];
  const sample = features.map((f) => firstPosition(f?.geometry?.coordinates)).find(Boolean);
  if (!sample) return { type: 'FeatureCollection', features };
  const tolerance = 0.01;
  const fitsLonLat = sample[0] >= minLon - tolerance && sample[0] <= maxLon + tolerance
    && sample[1] >= minLat - tolerance && sample[1] <= maxLat + tolerance;
  if (fitsLonLat) return { type: 'FeatureCollection', features };
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      ...f,
      geometry: f.geometry ? { ...f.geometry, coordinates: swapPositions(f.geometry.coordinates) } : f.geometry,
    })),
  };
}

export async function fetchCadastreWfs(envelope: Envelope, timeoutMs: number): Promise<any> {
  const response = await fetchWithTimeout(buildCadastreWfsUrl(envelope), {
    headers: { 'User-Agent': 'ArchiOffice/1.0 (cadastre lookup)', Accept: 'application/json' },
  }, timeoutMs);
  if (!response.ok) throw new Error(`WFS IGN ${response.status}`);
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('WFS IGN : réponse non JSON');
  return normalizeAxisOrder(await response.json(), envelope);
}
