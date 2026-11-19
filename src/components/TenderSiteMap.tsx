// Carte du site de chantier d'un appel d'offres : adresse du site, distance et temps de
// trajet depuis l'adresse de l'agence, isochrones de 30 min, 1 h, 1 h 30 et 2 h autour
// de l'agence. Les calculs passent par /api/geo/* (server/routes/geoTravel.ts), relais
// vers la Géoplateforme de l'IGN. Rien n'est stocké en dehors de l'adresse du site et de
// ses coordonnées, que l'écran hôte enregistre sur l'appel d'offres.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Même contournement que MapLibreCadastre : le worker de MapLibre 6 doit être compilé par Vite.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { AddressAutocomplete } from './AddressAutocomplete';
import { pointInGeometry } from '../lib/terrainParcelles';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface Point { lon: number; lat: number }
interface RouteInfo { distanceKm: number; durationMinutes: number | null; geometry: GeoJSON.Geometry | null; approximate: boolean }
interface Isochrone { seconds: number; geometry: GeoJSON.Geometry }

export const ISOCHRONES: { seconds: number; label: string; color: string }[] = [
  { seconds: 1800, label: '30 min', color: '#16a34a' },
  { seconds: 3600, label: '1 h', color: '#ca8a04' },
  { seconds: 5400, label: '1 h 30', color: '#ea580c' },
  { seconds: 7200, label: '2 h', color: '#dc2626' },
];

const MAP_STYLE: any = {
  version: 8,
  sources: {
    plan: {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
          + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
          + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
      ],
      tileSize: 256,
      attribution: '&copy; IGN-F/Géoportail',
    },
  },
  layers: [{ id: 'plan', type: 'raster', source: 'plan' }],
};

const colorExpression: any = ['match', ['get', 'seconds'], ...ISOCHRONES.flatMap(i => [i.seconds, i.color]), '#888888'];

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Plus petite isochrone contenant le point, ou null s'il est au-delà de toutes. */
export function containingIsochrone(point: Point, isochrones: Isochrone[]): number | null {
  const sorted = [...isochrones].sort((a, b) => a.seconds - b.seconds);
  const hit = sorted.find(i => pointInGeometry([point.lon, point.lat], i.geometry));
  return hit ? hit.seconds : null;
}

function collectCoordinates(value: unknown, out: [number, number][]): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    out.push([value[0], value[1]]);
    return;
  }
  value.forEach(v => collectCoordinates(v, out));
}

function boundsOf(points: Point[], geometries: GeoJSON.Geometry[]): [[number, number], [number, number]] | null {
  const coords: [number, number][] = points.map(p => [p.lon, p.lat]);
  geometries.forEach(g => { if ('coordinates' in g) collectCoordinates(g.coordinates, coords); });
  if (coords.length === 0) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  coords.forEach(([x, y]) => { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); });
  return [[west, south], [east, north]];
}

export interface TenderSiteChange { address: string; lat: number | null; lon: number | null }

interface TenderSiteMapProps {
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  /** Adresse du cabinet (Réglages), point de départ des trajets et des isochrones. */
  agencyAddress?: string | null;
  placeholder?: string;
  onSiteChange: (site: TenderSiteChange) => void | Promise<void>;
}

export function TenderSiteMap({ address, lat, lon, agencyAddress, placeholder, onSiteChange }: TenderSiteMapProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(address || '');
  const [geocodedSite, setGeocodedSite] = useState<Point | null>(null);
  const [agency, setAgency] = useState<Point | null>(null);
  const [agencyStatus, setAgencyStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'notfound'>('idle');
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [isochrones, setIsochrones] = useState<Isochrone[]>([]);
  const [isoStatus, setIsoStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isoPartial, setIsoPartial] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => { setDraft(address || ''); }, [address]);

  // Coordonnées enregistrées avec l'adresse ; à défaut (fiche ancienne), on géocode l'adresse.
  const storedSite: Point | null = Number.isFinite(lat) && Number.isFinite(lon) ? { lat: lat as number, lon: lon as number } : null;
  useEffect(() => {
    setGeocodedSite(null);
    if (storedSite || !address || address.trim().length < 3) return;
    let cancelled = false;
    apiFetch<{ lon: number; lat: number }>(`/api/geo/geocode?q=${encodeURIComponent(address)}`)
      .then(r => { if (!cancelled) setGeocodedSite({ lon: r.lon, lat: r.lat }); })
      .catch(() => { /* adresse introuvable : la carte reste masquée */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, storedSite?.lon, storedSite?.lat]);
  const site = storedSite ?? geocodedSite;
  const siteKey = site ? `${site.lon},${site.lat}` : '';

  // Position de l'agence.
  useEffect(() => {
    setAgency(null);
    const q = (agencyAddress || '').trim();
    if (q.length < 3) { setAgencyStatus('missing'); return; }
    let cancelled = false;
    setAgencyStatus('loading');
    apiFetch<{ lon: number; lat: number }>(`/api/geo/geocode?q=${encodeURIComponent(q)}`)
      .then(r => { if (!cancelled) { setAgency({ lon: r.lon, lat: r.lat }); setAgencyStatus('ready'); } })
      .catch(() => { if (!cancelled) setAgencyStatus('notfound'); });
    return () => { cancelled = true; };
  }, [agencyAddress]);
  const agencyKey = agency ? `${agency.lon},${agency.lat}` : '';

  // Distance et temps de trajet.
  useEffect(() => {
    setRoute(null);
    if (!site || !agency) return;
    let cancelled = false;
    setRouteLoading(true);
    apiFetch<RouteInfo>(`/api/geo/route?fromLon=${agency.lon}&fromLat=${agency.lat}&toLon=${site.lon}&toLat=${site.lat}`)
      .then(r => { if (!cancelled) setRoute(r); })
      .catch(() => { /* l'encart de distance reste vide */ })
      .finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, agencyKey]);

  // Isochrones depuis l'agence.
  useEffect(() => {
    setIsochrones([]);
    setIsoPartial(false);
    if (!agency || !site) { setIsoStatus('idle'); return; }
    let cancelled = false;
    setIsoStatus('loading');
    apiFetch<{ isochrones: Isochrone[]; failed: number[] }>(`/api/geo/isochrones?lon=${agency.lon}&lat=${agency.lat}`)
      .then(r => { if (cancelled) return; setIsochrones(r.isochrones || []); setIsoPartial((r.failed || []).length > 0); setIsoStatus('ready'); })
      .catch(() => { if (!cancelled) setIsoStatus('error'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyKey, !!site]);

  // Création de la carte dès que le site est connu.
  const hasSite = !!site;
  useEffect(() => {
    if (!hasSite || !containerRef.current) return;
    const first = site as Point;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: [first.lon, first.lat], zoom: 10, minZoom: 4, maxZoom: 18 });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('isochrones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'iso-fill', type: 'fill', source: 'isochrones', paint: { 'fill-color': colorExpression, 'fill-opacity': 0.14 } });
      map.addLayer({ id: 'iso-line', type: 'line', source: 'isochrones', paint: { 'line-color': colorExpression, 'line-width': 2 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#18181b', 'line-width': 3, 'line-dasharray': [2, 1] } });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSite]);

  // Données de la carte : isochrones (la plus grande dessous), trajet, marqueurs, cadrage.
  const sortedIsochrones = useMemo(() => [...isochrones].sort((a, b) => b.seconds - a.seconds), [isochrones]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !site) return;
    (map.getSource('isochrones') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: sortedIsochrones.map(i => ({ type: 'Feature', geometry: i.geometry, properties: { seconds: i.seconds } })),
    });
    (map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: route?.geometry ? [{ type: 'Feature', geometry: route.geometry, properties: {} }] : [],
    });
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [new maplibregl.Marker({ color: '#18181b', scale: 0.9 }).setLngLat([site.lon, site.lat]).addTo(map)];
    if (agency) markersRef.current.push(new maplibregl.Marker({ color: '#2563eb', scale: 0.9 }).setLngLat([agency.lon, agency.lat]).addTo(map));
    const bounds = boundsOf(agency ? [site, agency] : [site], sortedIsochrones.map(i => i.geometry));
    if (bounds && agency) map.fitBounds(bounds, { padding: 30, maxZoom: 13, duration: 0 });
    else map.jumpTo({ center: [site.lon, site.lat], zoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, siteKey, agencyKey, sortedIsochrones, route]);

  const within = site && isoStatus === 'ready' && isochrones.length > 0 ? containingIsochrone(site, isochrones) : undefined;
  const withinLabel = within ? ISOCHRONES.find(i => i.seconds === within)?.label : null;

  const labelStyle = { color: 'var(--tblr-muted)' };
  return (
    <div className="space-y-3">
      <AddressAutocomplete
        id="tender-site-address"
        label={t('tender_site_address_label')}
        value={draft}
        placeholder={placeholder}
        inputStyle={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
        onChange={(val: string) => {
          setDraft(val);
          if (!val && (address || lat != null)) void onSiteChange({ address: '', lat: null, lon: null });
        }}
        onSelect={details => {
          setDraft(details.fullAddress);
          void onSiteChange({ address: details.fullAddress, lat: details.lat ?? null, lon: details.lon ?? null });
        }}
      />

      {!site ? (
        <p className="text-xs italic" style={labelStyle}>{t('tender_site_no_address')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider" style={labelStyle}>
                {route?.approximate ? t('tender_site_distance_approx') : t('tender_site_distance')}
              </p>
              <p className="font-semibold" style={{ color: 'var(--tblr-text)' }}>
                {routeLoading ? <IconLoader2 size={14} className="animate-spin inline" /> : route ? `${route.distanceKm.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider" style={labelStyle}>{t('tender_site_duration')}</p>
              <p className="font-semibold" style={{ color: 'var(--tblr-text)' }}>
                {routeLoading ? <IconLoader2 size={14} className="animate-spin inline" /> : route?.durationMinutes != null ? formatDuration(route.durationMinutes) : '-'}
              </p>
            </div>
          </div>

          {agencyStatus === 'missing' && <p className="text-xs italic" style={labelStyle}>{t('tender_site_agency_missing')}</p>}
          {agencyStatus === 'notfound' && <p className="text-xs italic" style={labelStyle}>{t('tender_site_agency_not_found')}</p>}

          <div ref={containerRef} className="w-full h-80 rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }} />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={labelStyle}>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#18181b' }} />{t('tender_site_site')}</span>
            {agency && <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} />{t('tender_site_agency')}</span>}
            {agency && ISOCHRONES.map(i => (
              <span key={i.seconds} className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: i.color, opacity: 0.55 }} />{i.label}
              </span>
            ))}
            {isoStatus === 'loading' && <span className="flex items-center gap-1"><IconLoader2 size={12} className="animate-spin" />{t('tender_site_loading')}</span>}
          </div>

          {agency && isoStatus === 'ready' && (
            <p className="text-xs" style={{ color: 'var(--tblr-text)' }}>
              {withinLabel ? t('tender_site_in_iso', { label: withinLabel }) : t('tender_site_beyond_iso')}
            </p>
          )}
          {isoStatus === 'error' && <p className="text-xs italic" style={labelStyle}>{t('tender_site_iso_error')}</p>}
          {isoPartial && <p className="text-xs italic" style={labelStyle}>{t('tender_site_iso_partial')}</p>}
        </>
      )}
    </div>
  );
}
