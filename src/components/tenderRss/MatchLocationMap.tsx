// Petite carte de situation du lieu d'exécution d'une annonce de la veille (plan IGN, un repère).
// Le lieu est géocodé par /api/geo/geocode (server/routes/geoTravel.ts) ; rien n'est enregistré.
// Chargée à la demande par l'écran hôte : MapLibre ne pèse pas sur la page tant qu'aucune annonce
// n'est ouverte.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Même contournement que MapLibreCadastre : le worker de MapLibre 6 doit être compilé par Vite.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { IconLoader2, IconMapPin } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { usableSiteAddress } from '../../lib/tenderSiteAddress';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

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

const ZOOM_COMMUNE = 11;

// « 51 Marne », « 2A Corse-du-Sud » : numéro et nom de département, sans voie. Un géocodeur y verrait
// une rue et placerait le repère au mauvais endroit : on préfère ne pas situer.
const STREET_WORD = /^(rue|avenue|av|boulevard|bd|chemin|place|route|all[ée]e|impasse|quai|cours|passage|square|zone|za|zac)\b/i;
function isDepartmentOnly(address: string): boolean {
  const m = address.match(/^(\d{2,3}|2[AB])\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,2})$/i);
  return !!m && !STREET_WORD.test(m[2]);
}

interface MatchLocationMapProps {
  /** « Lieu d'exécution » tel que publié dans l'annonce (`ville_execution`). */
  location?: string | null;
}

type Status = 'none' | 'loading' | 'ready' | 'notfound';

export default function MatchLocationMap({ location }: MatchLocationMapProps) {
  const { t } = useTranslation();
  const usable = usableSiteAddress(location);
  const address = usable && !isDepartmentOnly(usable) ? usable : null;
  const [status, setStatus] = useState<Status>(address ? 'loading' : 'none');
  const [point, setPoint] = useState<{ lon: number; lat: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Géocodage du lieu, à chaque changement d'annonce.
  useEffect(() => {
    setPoint(null);
    if (!address) { setStatus('none'); return; }
    let cancelled = false;
    setStatus('loading');
    apiFetch<{ lon: number; lat: number }>(`/api/geo/geocode?q=${encodeURIComponent(address)}`)
      .then(r => { if (!cancelled) { setPoint({ lon: r.lon, lat: r.lat }); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('notfound'); });
    return () => { cancelled = true; };
  }, [address]);

  // La carte est créée une fois le point connu, puis simplement recentrée d'une annonce à l'autre.
  const hasPoint = !!point;
  useEffect(() => {
    if (!hasPoint || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [point!.lon, point!.lat],
      zoom: ZOOM_COMMUNE,
      minZoom: 4,
      maxZoom: 17,
      // Le défilement de la page ne doit pas zoomer la carte quand le curseur la survole.
      scrollZoom: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !point) return;
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: '#18181b', scale: 0.9 }).setLngLat([point.lon, point.lat]).addTo(map);
    map.jumpTo({ center: [point.lon, point.lat], zoom: ZOOM_COMMUNE });
  }, [point?.lon, point?.lat]);

  const muted = { color: 'var(--tblr-muted)' };
  return (
    <div
      className="rounded-lg overflow-hidden shrink-0"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b text-xs font-bold uppercase tracking-wider" style={{ borderColor: 'var(--tblr-border)', ...muted }}>
        <IconMapPin size={14} aria-hidden />
        <span>{t('tender_rss_location_title')}</span>
        {address && <span className="normal-case font-normal truncate" title={address}>{address}</span>}
      </div>
      {status === 'ready' ? (
        <div ref={containerRef} className="w-full h-52" role="img" aria-label={t('tender_rss_location_map_label', { place: address ?? '' }) as string} />
      ) : (
        <div className="flex h-24 items-center justify-center gap-2 px-4 text-center text-xs" style={muted}>
          {status === 'loading' && <IconLoader2 size={14} className="animate-spin" aria-hidden />}
          {status === 'loading' ? t('tender_site_loading') : status === 'notfound' ? t('tender_rss_location_not_found') : t('tender_rss_location_none')}
        </div>
      )}
    </div>
  );
}
