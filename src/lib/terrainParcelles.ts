// Terrain d'une proposition : parcelles cochées sur la carte, adresse déduite de
// la parcelle et surface totale. Logique pure (sauf `fetchParcelAddress`), testée
// dans `__tests__/terrainParcelles.test.ts`.
import type { SelectableParcel } from './cadastreSelection';

export interface StoredParcel extends SelectableParcel {
  commune: string;
  insee: string;
}

/** Au-delà, un terrain n'est plus une opération : borne la taille du JSON enregistré. */
export const MAX_STORED_PARCELS = 50;

/** Une adresse trouvée plus loin que cela du centre de la parcelle n'est pas proposée. */
export const MAX_ADDRESS_DISTANCE_M = 250;

export function serializeParcels(parcels: StoredParcel[]): string {
  return JSON.stringify(parcels.slice(0, MAX_STORED_PARCELS));
}

const isPolygonal = (g: unknown): g is GeoJSON.Polygon | GeoJSON.MultiPolygon =>
  !!g && typeof g === 'object'
  && ((g as { type?: string }).type === 'Polygon' || (g as { type?: string }).type === 'MultiPolygon')
  && Array.isArray((g as { coordinates?: unknown }).coordinates);

/**
 * Relit la sélection enregistrée. Ne lève jamais : un JSON absent, corrompu ou
 * d'une forme inattendue donne une sélection vide plutôt qu'un écran cassé.
 */
export function parseStoredParcels(raw: unknown): StoredParcel[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { value = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const out: StoredParcel[] = [];
  for (const item of value) {
    if (out.length >= MAX_STORED_PARCELS) break;
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || !p.id) continue;
    out.push({
      id: p.id,
      section: typeof p.section === 'string' ? p.section : '',
      numero: typeof p.numero === 'string' || typeof p.numero === 'number' ? String(p.numero) : '',
      prefixe: typeof p.prefixe === 'string' ? p.prefixe : '',
      commune: typeof p.commune === 'string' ? p.commune : '',
      insee: typeof p.insee === 'string' ? p.insee : '',
      ...(typeof p.contenance === 'number' && Number.isFinite(p.contenance) ? { contenance: p.contenance } : {}),
      ...(isPolygonal(p.geometry) ? { geometry: p.geometry } : {}),
    });
  }
  return out;
}

/** Mêmes parcelles, dans le même ordre ? (comparaison par identifiant) */
export function sameParcelIds(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id);
}

/**
 * Surface cumulée des parcelles. `complete` vaut faux dès qu'une contenance est
 * inconnue : le total n'est alors qu'une somme partielle et l'écran doit le dire.
 */
export function totalSurface(parcels: SelectableParcel[]): { total: number; complete: boolean } {
  let total = 0;
  let complete = true;
  for (const p of parcels) {
    if (typeof p.contenance === 'number') total += p.contenance;
    else complete = false;
  }
  return { total, complete };
}

// Ray casting simple, sur le contour extérieur de chaque polygone : suffisant
// pour repérer la parcelle sous un point, sans dépendance à une lib SIG.
export const pointInGeometry = (point: [number, number], geometry: GeoJSON.Geometry): boolean => {
  const inRing = (ring: number[][]): boolean => {
    let inside = false;
    const [x, y] = point;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };
  if (geometry.type === 'Polygon') return inRing(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => inRing(poly[0]));
  return false;
};

/** Le point tombe-t-il sur l'une des parcelles ? */
export const pointInParcels = (point: [number, number], parcels: SelectableParcel[]): boolean =>
  parcels.some((p) => !!p.geometry && pointInGeometry(point, p.geometry));

const ringArea = (ring: number[][]): number => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
};

/** Centre de gravité du contour extérieur (le plus grand pour un MultiPolygon), [lon, lat]. */
export function parcelCentroid(geometry: GeoJSON.Geometry | undefined): [number, number] | null {
  if (!geometry) return null;
  const rings: number[][][] = geometry.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates.map((poly) => poly[0])
      : [];
  const valid = rings.filter((r) => Array.isArray(r) && r.length >= 3);
  if (valid.length === 0) return null;
  const ring = valid.reduce((best, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(best)) ? r : best));
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-14) {
    const n = ring.length;
    return [ring.reduce((s, c) => s + c[0], 0) / n, ring.reduce((s, c) => s + c[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * area), cy / (6 * area)];
};

const normalizeAddress = (value: string): string =>
  value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Deux écritures d'une même adresse (casse, accents, ponctuation) ne comptent pas comme un changement. */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  return normalizeAddress(a ?? '') === normalizeAddress(b ?? '');
}

export interface ParcelAddress {
  label: string;
  zipcode: string;
  city: string;
  banId: string;
  cityCode: string;
  distance: number | null;
}

/** Adresse la plus proche d'un point, ou `null` s'il n'y en a pas (ou trop loin). */
export async function fetchParcelAddress(
  [lon, lat]: [number, number],
  signal?: AbortSignal,
): Promise<ParcelAddress | null> {
  const res = await fetch(`/api/address-reverse?lon=${lon}&lat=${lat}`, { signal });
  if (!res.ok) throw new Error(`Adresse indisponible (${res.status})`);
  const data = await res.json();
  const props = data?.features?.[0]?.properties;
  if (!props?.label) return null;
  const distance = typeof props.distance === 'number' ? props.distance : null;
  if (distance != null && distance > MAX_ADDRESS_DISTANCE_M) return null;
  return {
    label: String(props.label),
    zipcode: String(props.postcode || ''),
    city: String(props.city || ''),
    banId: String(props.id || ''),
    cityCode: String(props.citycode || ''),
    distance,
  };
}
