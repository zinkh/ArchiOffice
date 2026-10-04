// Extraits de cartes de l'étude de faisabilité : calculs purs (aucun canvas,
// aucun réseau) partagés par l'écran de composition
// (src/components/proposal/FeasibilityMapDialog.tsx) et par le relais de
// tuiles du serveur (server/routes/proposalFeasibility.ts), qui n'accepte que
// les couches listées ici. Testé dans src/lib/__tests__/feasibilityMap.test.ts.
//
// Les tuiles sont celles du WMTS de la Géoplateforme IGN en projection Web
// Mercator (matrice « PM »), les mêmes couches que la carte cadastrale de la
// proposition (MapLibreCadastre.tsx) : leur disponibilité est déjà éprouvée.

export type FeasibilityMapLayerId = 'plan' | 'ortho' | 'cadastre';

export interface FeasibilityMapLayer {
  wmtsLayer: string;
  format: 'image/png' | 'image/jpeg';
  maxZoom: number;
}

export const FEASIBILITY_MAP_LAYERS: Record<FeasibilityMapLayerId, FeasibilityMapLayer> = {
  plan: { wmtsLayer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', maxZoom: 19 },
  ortho: { wmtsLayer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', maxZoom: 19 },
  cadastre: { wmtsLayer: 'CADASTRALPARCELS.PARCELS', format: 'image/png', maxZoom: 19 },
};

/** Fond de carte, éventuellement surmonté du parcellaire. */
export interface FeasibilityMapPreset {
  id: string;
  base: 'plan' | 'ortho';
  cadastre: boolean;
}

export const FEASIBILITY_MAP_PRESETS: FeasibilityMapPreset[] = [
  { id: 'plan', base: 'plan', cadastre: false },
  { id: 'ortho', base: 'ortho', cadastre: false },
  { id: 'ortho_cadastre', base: 'ortho', cadastre: true },
  { id: 'plan_cadastre', base: 'plan', cadastre: true },
];

/** Largeur de terrain couverte par l'extrait, en mètres. */
export const FEASIBILITY_MAP_EXTENTS = [100, 250, 500, 1000, 2500, 5000];

/** Largeur d'impression de l'extrait dans l'étude (A4 portrait, marges déduites). */
export const PRINT_WIDTH_MM = 170;

export const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE = 40_075_016.686;

/** Coordonnées « monde » en pixels au niveau de zoom z (origine en haut à gauche). */
export function lonLatToWorldPx(lon: number, lat: number, z: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Mètres au sol par pixel d'une tuile au niveau z et à la latitude donnée. */
export function metersPerPixel(lat: number, z: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** z);
}

export interface TilePlacement { x: number; y: number; dx: number; dy: number; size: number }

export interface MapExtractPlan {
  z: number;
  /** Pixels de sortie par pixel de tuile : ≤ 1, sauf au zoom maximal de la couche où l'image est agrandie. */
  scale: number;
  /** Mètres au sol par pixel de SORTIE. */
  metersPerOutPx: number;
  tiles: TilePlacement[];
  /** Projette un point (lon, lat) dans le repère de l'image de sortie. */
  project: (lon: number, lat: number) => { x: number; y: number };
}

/**
 * Prépare un extrait centré sur (lon, lat), couvrant `widthM` mètres sur
 * `outW` pixels. Choisit le niveau de zoom le plus grossier qui donne au moins
 * un pixel de tuile par pixel de sortie (sinon l'image serait floue), borné au
 * zoom maximal de la couche, et liste les tuiles à dessiner avec leur position.
 */
export function planMapExtract(opts: { lon: number; lat: number; widthM: number; outW: number; outH: number; maxZoom: number }): MapExtractPlan {
  const { lon, lat, widthM, outW, outH, maxZoom } = opts;
  const targetMpp = widthM / outW;
  let z = 0;
  while (z < maxZoom && metersPerPixel(lat, z) > targetMpp) z++;
  const scale = metersPerPixel(lat, z) / targetMpp; // pixels de sortie par pixel de tuile
  const center = lonLatToWorldPx(lon, lat, z);
  // Coin haut-gauche de la sortie en pixels monde.
  const originX = center.x - outW / 2 / scale;
  const originY = center.y - outH / 2 / scale;
  const max = 2 ** z;
  const x0 = Math.floor(originX / TILE_SIZE);
  const y0 = Math.floor(originY / TILE_SIZE);
  const x1 = Math.floor((originX + outW / scale) / TILE_SIZE);
  const y1 = Math.floor((originY + outH / scale) / TILE_SIZE);
  const tiles: TilePlacement[] = [];
  for (let ty = Math.max(0, y0); ty <= Math.min(max - 1, y1); ty++) {
    for (let tx = Math.max(0, x0); tx <= Math.min(max - 1, x1); tx++) {
      tiles.push({
        x: tx, y: ty,
        dx: (tx * TILE_SIZE - originX) * scale,
        dy: (ty * TILE_SIZE - originY) * scale,
        size: TILE_SIZE * scale,
      });
    }
  }
  return {
    z, scale, metersPerOutPx: targetMpp, tiles,
    project: (plon, plat) => {
      const p = lonLatToWorldPx(plon, plat, z);
      return { x: (p.x - originX) * scale, y: (p.y - originY) * scale };
    },
  };
}

/** Longueur « ronde » de barre d'échelle (1, 2, 5 × 10^n m) tenant dans maxPx. */
export function niceScaleBar(metersPerOutPx: number, maxPx: number): { meters: number; px: number; label: string } {
  const maxMeters = metersPerOutPx * maxPx;
  const pow = 10 ** Math.floor(Math.log10(maxMeters));
  const meters = [5, 2, 1].map(f => f * pow).find(m => m <= maxMeters) ?? pow;
  return { meters, px: meters / metersPerOutPx, label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m` };
}

/** Échelle approchée (dénominateur arrondi) d'un extrait imprimé sur PRINT_WIDTH_MM. */
export function approximateScale(widthM: number, printWidthMm = PRINT_WIDTH_MM): number {
  const raw = (widthM * 1000) / printWidthMm;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 1.25, 2, 2.5, 5, 10].map(f => f * pow);
  return Math.round(nice.reduce((best, n) => (Math.abs(n - raw) < Math.abs(best - raw) ? n : best), nice[0]));
}

/** Légende par défaut d'un extrait. */
export function defaultMapCaption(presetLabel: string, scale: number): string {
  return `${presetLabel}, échelle approximative 1/${scale.toLocaleString('fr-FR').replace(/[  ]/g, ' ')}`;
}

type Ring = number[][];

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Le point est-il dans le polygone (trous compris) ? Sert à ne tracer que la
 * parcelle qui contient l'adresse : faute de parcelle au point exact, le
 * service cadastral renvoie les parcelles voisines, qu'il serait faux de
 * présenter comme le terrain de l'opération.
 */
export function pointInGeometry(lon: number, lat: number, geometry: { type: string; coordinates: any } | null | undefined): boolean {
  if (!geometry) return false;
  const polygons: Ring[][] = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(([outer, ...holes]) => !!outer && pointInRing(lon, lat, outer) && !holes.some(h => pointInRing(lon, lat, h)));
}

/** Anneaux extérieurs et intérieurs d'une géométrie surfacique, pour le tracé. */
export function geometryRings(geometry: { type: string; coordinates: any } | null | undefined): Ring[] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Ring[][]).flat();
  return [];
}
