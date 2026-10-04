// Données publiques du terrain d'une proposition, pour son étude de faisabilité :
// géocodage de l'adresse (Géoplateforme IGN), zone du PLU (APICarto GPU),
// risques (Géorisques) et monuments historiques proches (Mérimée).
//
// Réutilise les fonctions déjà écrites pour les panneaux de la proposition
// (server/routes/geoProxy.ts) plutôt que de rappeler ces routes en boucle
// locale. Chaque service est interrogé en meilleur effort et indépendamment
// des autres : une panne de Géorisques ne prive pas l'étude de la zone PLU.
// Mise en cache 10 minutes par adresse : « Insérer » puis « Rédiger avec IA »
// sur plusieurs rubriques relisent la même adresse en quelques minutes.
import { fetchWithTimeout } from './fetchWithTimeout';
import { getPlu, getGeorisques, findHistoricalMonuments } from './routes/geoProxy';
import { EMPTY_SITE_DATA, MONUMENTS_RADIUS_M, type FeasibilitySiteData } from '../src/lib/feasibilityBlocks';

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { expiresAt: number; data: FeasibilitySiteData }>();

async function geocode(query: string): Promise<FeasibilitySiteData['address']> {
  const url = `https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
  if (!res.ok) return null;
  const json: any = await res.json();
  const f = json?.features?.[0];
  if (!f?.geometry?.coordinates) return null;
  return {
    label: String(f.properties?.label || query),
    lon: Number(f.geometry.coordinates[0]),
    lat: Number(f.geometry.coordinates[1]),
    citycode: String(f.properties?.citycode || ''),
    city: String(f.properties?.city || ''),
  };
}

export async function loadFeasibilitySiteData(addressQuery: string): Promise<FeasibilitySiteData> {
  const query = addressQuery.trim();
  if (query.length < 3) return EMPTY_SITE_DATA;
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const address = await geocode(query).catch(() => null);
  if (!address || !Number.isFinite(address.lat) || !Number.isFinite(address.lon)) return EMPTY_SITE_DATA;

  const point = { type: 'Point', coordinates: [address.lon, address.lat] };
  const [plu, risques, monuments] = await Promise.all([
    getPlu(point).catch(() => null),
    address.citycode ? getGeorisques(address.lon, address.lat, address.citycode).catch(() => null) : Promise.resolve(null),
    /^\d{5}$/.test(address.citycode)
      ? findHistoricalMonuments(address.lat, address.lon, address.citycode, MONUMENTS_RADIUS_M).catch(() => null)
      : Promise.resolve(null),
  ]);

  const data: FeasibilitySiteData = {
    address,
    plu: plu ? {
      libelle: plu.libelle, libelong: plu.libelong, typezone: plu.typezone, destdomi: plu.destdomi,
      urlfic: plu.urlfic, datappro: plu.datappro, document: plu.document,
    } : null,
    risques,
    monuments: monuments ? monuments.map((m: any) => ({
      nom: String(m.fields?.tico || 'Monument historique'),
      statut: String(m.fields?.dpro || ''),
      commune: String(m.fields?.comm || ''),
      distance_m: Number(m.fields?.dist || 0),
    })) : null,
  };

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return data;
}
