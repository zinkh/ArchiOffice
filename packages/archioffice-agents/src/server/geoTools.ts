// ── Outils cartographiques et réglementaires ────────────────────────────────
// Adossés aux mêmes proxys que les cartes de l'application
// (server/routes/geoProxy.ts) : adresse (BAN), parcelle cadastrale (IGN
// APICARTO), zonage PLU (Géoportail de l'urbanisme), risques (Géorisques) et
// monuments historiques.
//
// Ces API renvoient de la GeoJSON : une seule parcelle peut peser plusieurs
// milliers de points de contour, facturés au token et sans aucune utilité
// pour le modèle. Tout ce qui est géométrie est donc retiré avant de rendre
// la réponse, et le nombre d'entités est plafonné.
import type { FunctionDeclarationLike, ToolOutcome } from './toolTypes.js';

const MAX_FEATURES = 10;
const GEOMETRY_KEYS = new Set(['geometry', 'coordinates', 'geo_shape', 'geo_point_2d', 'contour', 'bbox']);

export function stripGeometry(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_FEATURES).map(v => stripGeometry(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (GEOMETRY_KEYS.has(k)) continue;
      const cleaned = stripGeometry(v, depth + 1);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

async function getJson(baseUrl: string, path: string, authHeader: string): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(baseUrl + path, { headers: { Authorization: authHeader } });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
  } catch (e: any) {
    return { ok: false, data: { error: e?.message || 'Requête impossible.' } };
  }
}

const COORD_PARAMS = {
  lat: { type: 'number', description: 'Latitude en degrés décimaux (WGS84)' },
  lon: { type: 'number', description: 'Longitude en degrés décimaux (WGS84)' },
};

export function buildGeoTools(): FunctionDeclarationLike[] {
  return [
    {
      name: 'search_address',
      description:
        "Recherche une adresse française dans la Base Adresse Nationale et retourne ses coordonnées (lat/lon), son code INSEE et son code postal. " +
        "C'est le point d'entrée des autres outils cartographiques, qui attendent des coordonnées.",
      parametersJsonSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: "Adresse ou lieu recherché (ex. « 23 Bd de l'Europe Vandoeuvre-lès-Nancy »)" } },
        required: ['query'],
      },
    },
    {
      name: 'get_parcelle_cadastrale',
      description: "Retourne la ou les parcelles cadastrales situées à des coordonnées données (section, numéro, commune, contenance).",
      parametersJsonSchema: { type: 'object', properties: { ...COORD_PARAMS }, required: ['lat', 'lon'] },
    },
    {
      name: 'get_zone_plu',
      description: "Retourne le zonage d'urbanisme (PLU/PLUi) applicable à des coordonnées : libellé de zone, type de zone et document d'urbanisme de référence.",
      parametersJsonSchema: { type: 'object', properties: { ...COORD_PARAMS }, required: ['lat', 'lon'] },
    },
    {
      name: 'get_risques',
      description: "Retourne les risques recensés par Géorisques pour une localisation (retrait-gonflement des argiles, inondation, sismicité, radon, installations classées...).",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          ...COORD_PARAMS,
          code_insee: { type: 'string', description: 'Code INSEE de la commune, tel que renvoyé par search_address' },
        },
        required: ['lat', 'lon', 'code_insee'],
      },
    },
    {
      name: 'get_monuments_historiques',
      description: "Liste les monuments historiques protégés autour de coordonnées données — utile pour savoir si un projet tombe dans un périmètre de protection (abords, ABF).",
      parametersJsonSchema: {
        type: 'object',
        properties: {
          ...COORD_PARAMS,
          distance: { type: 'number', description: 'Rayon de recherche en mètres (défaut 1000, maximum 50000)' },
        },
        required: ['lat', 'lon'],
      },
    },
  ];
}

export async function executeGeoTool(
  baseUrl: string,
  authHeader: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const lat = Number(args.lat);
  const lon = Number(args.lon);
  const needsCoords = name !== 'search_address';
  if (needsCoords && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    return { response: { error: 'lat et lon sont requis (utilise search_address pour les obtenir à partir d\'une adresse).' } };
  }

  if (name === 'search_address') {
    const query = String(args.query || '').trim();
    if (!query) return { response: { error: 'query est requis.' } };
    const { ok, data } = await getJson(baseUrl, `/api/address-search?q=${encodeURIComponent(query)}`, authHeader);
    if (!ok) return { response: { error: data?.error || "Recherche d'adresse impossible." } };
    const features = (data?.features || []).slice(0, MAX_FEATURES).map((f: any) => ({
      label: f.properties?.label,
      postcode: f.properties?.postcode,
      city: f.properties?.city,
      code_insee: f.properties?.citycode,
      lon: f.geometry?.coordinates?.[0],
      lat: f.geometry?.coordinates?.[1],
      ban_id: f.properties?.id,
    }));
    return { response: { count: features.length, results: features }, summary: `Adresse recherchée : ${query}` };
  }

  if (name === 'get_parcelle_cadastrale') {
    const { ok, data } = await getJson(baseUrl, `/api/cadastre/parcel?lat=${lat}&lon=${lon}`, authHeader);
    if (!ok) return { response: { error: data?.error || 'Recherche cadastrale impossible.' } };
    return { response: { parcelles: stripGeometry(data) }, summary: 'Parcelle cadastrale consultée' };
  }

  if (name === 'get_zone_plu') {
    const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
    const { ok, data } = await getJson(baseUrl, `/api/urbanisme?geom=${geom}`, authHeader);
    if (!ok) return { response: { error: data?.error || 'Consultation du PLU impossible.' } };
    return { response: { urbanisme: stripGeometry(data) }, summary: 'Zonage PLU consulté' };
  }

  if (name === 'get_risques') {
    const insee = String(args.code_insee || '').trim();
    if (!insee) return { response: { error: 'code_insee est requis (renvoyé par search_address).' } };
    const { ok, data } = await getJson(baseUrl, `/api/georisques?latitude=${lat}&longitude=${lon}&code_insee=${encodeURIComponent(insee)}`, authHeader);
    if (!ok) return { response: { error: data?.error || 'Consultation Géorisques impossible.' } };
    return { response: { risques: stripGeometry(data) }, summary: 'Risques Géorisques consultés' };
  }

  if (name === 'get_monuments_historiques') {
    const distanceArg = Number(args.distance);
    const distance = Number.isFinite(distanceArg) && distanceArg > 0 ? Math.min(distanceArg, 50000) : 1000;
    const { ok, data } = await getJson(baseUrl, `/api/historical-monuments?lat=${lat}&lon=${lon}&distance=${distance}`, authHeader);
    if (!ok) return { response: { error: data?.error || 'Consultation des monuments historiques impossible.' } };
    return { response: { rayon_m: distance, monuments: stripGeometry(data) }, summary: 'Monuments historiques consultés' };
  }

  return { response: { error: `Fonction cartographique inconnue : ${name}` } };
}

export const GEO_TOOL_NAMES = ['search_address', 'get_parcelle_cadastrale', 'get_zone_plu', 'get_risques', 'get_monuments_historiques'];
