import { useEffect, useRef, useState, useCallback } from 'react';
// maplibre-gl 6 dropped the default export (named exports only) — this
// namespace import keeps every existing maplibregl.Map/.Marker/... call
// site below unchanged.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { IconX } from '@tabler/icons-react';
import { toggleParcel, summarizeParcels, formatSurface } from '../lib/cadastreSelection';

const CADASTRE_MIN_ZOOM = 13;

export interface CadastreParcel {
  id: string;
  section: string;
  numero: string;
  prefixe: string;
  commune: string;
  insee: string;
  contenance?: number;
  geometry?: GeoJSON.Geometry;
}

// Vue aérienne officielle (IGN Géoplateforme, sans clé) — remplace les tuiles
// raster OpenStreetMap, dont l'usage en production dépasse la politique des
// serveurs bénévoles du projet (d'où le blocage visible sur le fond de carte).
const MAP_STYLE = (lon: number, lat: number): any => ({
  version: 8,
  sources: {
    ortho: {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
          '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
          '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
      ],
      tileSize: 256,
      attribution: '&copy; IGN-F/Géoportail',
    },
    // Couche cadastrale officielle de secours. Elle garantit que les limites
    // restent visibles même si l'API vectorielle APICARTO est momentanément
    // vide ou indisponible ; les polygones GeoJSON placés au-dessus gardent
    // la sélection interactive au clic lorsqu'ils sont disponibles.
    cadastreRaster: {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
          '&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&FORMAT=image/png' +
          '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      ],
      tileSize: 256,
      minzoom: CADASTRE_MIN_ZOOM,
      attribution: '&copy; IGN Cadastre',
    },
    parcelles: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      generateId: true,
    },
    // Sélection tenue dans sa propre source, avec la géométrie de chaque
    // parcelle : `parcelles` est rechargée à chaque déplacement de la carte
    // (et ses ids générés changent alors), un feature-state n'y survivrait pas.
    selection: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
  },
  layers: [
    { id: 'ortho-layer', type: 'raster', source: 'ortho' },
    {
      id: 'cadastre-raster-layer',
      type: 'raster',
      source: 'cadastreRaster',
      minzoom: CADASTRE_MIN_ZOOM,
      paint: { 'raster-opacity': 0.42 },
    },
    {
      id: 'parcelles-fill',
      type: 'fill',
      source: 'parcelles',
      minzoom: CADASTRE_MIN_ZOOM,
      paint: {
        'fill-color': '#ffffff',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, 0],
      },
    },
    {
      id: 'parcelles-line',
      type: 'line',
      source: 'parcelles',
      minzoom: CADASTRE_MIN_ZOOM,
      paint: { 'line-color': '#18181b', 'line-width': 1, 'line-opacity': 0.85 },
    },
    {
      id: 'selection-fill',
      type: 'fill',
      source: 'selection',
      paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.12 },
    },
    {
      id: 'selection-line',
      type: 'line',
      source: 'selection',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#f59e0b', 'line-width': 3, 'line-dasharray': [2, 1.5] },
    },
  ],
  center: [lon, lat],
  zoom: 19,
});

// Emprise approximative d'une parcelle pavillonnaire — sert de secours quand
// aucune parcelle n'englobe le marqueur (adresse en bordure de parcelle,
// parcelle non encore chargée...).
const FALLBACK_HALF_EXTENT_DEG = 0.0009;

const geometryBounds = (geometry: GeoJSON.Geometry): [[number, number], [number, number]] | null => {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const visit = (coords: any): void => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords as [number, number];
      if (x < west) west = x;
      if (x > east) east = x;
      if (y < south) south = y;
      if (y > north) north = y;
    } else {
      coords.forEach(visit);
    }
  };
  if (!('coordinates' in geometry)) return null;
  visit(geometry.coordinates);
  if (!isFinite(west) || !isFinite(south) || !isFinite(east) || !isFinite(north)) return null;
  return [[west, south], [east, north]];
};

// Ray casting simple, sur le contour extérieur de chaque polygone — suffisant
// pour repérer la parcelle sous le marqueur, sans dépendance à une lib SIG.
const pointInGeometry = (point: [number, number], geometry: GeoJSON.Geometry): boolean => {
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

interface MapLibreCadastreProps {
  lat: number;
  lon: number;
  /** Rend les parcelles sélectionnables au clic (plusieurs à la fois, un second clic retire). */
  onSelectionChange?: (parcels: CadastreParcel[]) => void;
}

export const MapLibreCadastre = ({ lat, lon, onSelectionChange }: MapLibreCadastreProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [zoom, setZoom] = useState(19);
  const [parcelStatus, setParcelStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const hoveredId = useRef<number | string | null>(null);
  const [selection, setSelection] = useState<CadastreParcel[]>([]);
  const selectionRef = useRef<CadastreParcel[]>([]);
  const fetchAbort = useRef<AbortController | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const applySelection = useCallback((next: CadastreParcel[]) => {
    selectionRef.current = next;
    setSelection(next);
    const source = map.current?.getSource('selection') as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: next.filter((p) => p.geometry).map((p) => ({
        type: 'Feature', geometry: p.geometry as GeoJSON.Geometry, properties: { id: p.id },
      })),
    });
    onSelectionChangeRef.current?.(next);
  }, []);
  // N'ajuste le cadrage à la parcelle qu'une fois, au premier chargement —
  // sans ça, chaque déplacement de la carte (moveend) re-fitterait dessus.
  const fittedParcel = useRef(false);

  const fetchParcelles = useCallback((instance: maplibregl.Map, center?: [number, number]) => {
    if (instance.getZoom() < CADASTRE_MIN_ZOOM) return;
    const source = instance.getSource('parcelles') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    fetchAbort.current?.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;

    const b = instance.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');

    setParcelStatus('loading');
    fetch(`/api/cadastre/parcel?bbox=${bbox}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.ok) return res.json();
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `Cadastre indisponible (${res.status})`);
      })
      .then((data) => {
        if (!data?.features) throw new Error('Réponse cadastrale invalide');
        source.setData(data);
        setParcelStatus(data.features.length > 0 ? 'ready' : 'empty');
        if (center && !fittedParcel.current) {
          fittedParcel.current = true;
          const containing = data.features.find((f: GeoJSON.Feature) => f.geometry && pointInGeometry(center, f.geometry));
          const bounds = containing ? geometryBounds(containing.geometry) : null;
          instance.fitBounds(
            bounds ?? [
              [center[0] - FALLBACK_HALF_EXTENT_DEG, center[1] - FALLBACK_HALF_EXTENT_DEG],
              [center[0] + FALLBACK_HALF_EXTENT_DEG, center[1] + FALLBACK_HALF_EXTENT_DEG],
            ],
            { padding: 40, maxZoom: 20, duration: 0 },
          );
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setParcelStatus('error');
          console.warn('[MapLibreCadastre] parcel fetch failed', err);
        }
      });
  }, []);

  const initMap = useCallback(() => {
    if (!mapContainer.current) return;

    map.current?.remove();
    map.current = null;
    marker.current = null;
    fittedParcel.current = false;
    selectionRef.current = [];
    setSelection([]);

    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE(lon, lat),
      maxZoom: 19,
      minZoom: 5,
    });

    instance.on('load', () => {
      marker.current = new maplibregl.Marker({ color: '#18181b', scale: 0.8 })
        .setLngLat([lon, lat])
        .addTo(instance);
      setZoom(Math.round(instance.getZoom()));
      fetchParcelles(instance, [lon, lat]);
    });

    instance.on('zoomend', () => setZoom(Math.round(instance.getZoom())));
    instance.on('moveend', () => fetchParcelles(instance));

    instance.on('mousemove', 'parcelles-fill', (e) => {
      if (!e.features?.length) return;
      const id = e.features[0].id;
      if (id === undefined || id === hoveredId.current) return;
      if (hoveredId.current !== null) {
        instance.setFeatureState({ source: 'parcelles', id: hoveredId.current }, { hover: false });
      }
      hoveredId.current = id;
      instance.setFeatureState({ source: 'parcelles', id }, { hover: true });
      if (onSelectionChangeRef.current) instance.getCanvas().style.cursor = 'pointer';
    });

    instance.on('mouseleave', 'parcelles-fill', () => {
      if (hoveredId.current !== null) {
        instance.setFeatureState({ source: 'parcelles', id: hoveredId.current }, { hover: false });
        hoveredId.current = null;
      }
      instance.getCanvas().style.cursor = '';
    });

    instance.on('click', 'parcelles-fill', (e) => {
      if (!onSelectionChangeRef.current || !e.features?.length) return;
      const feature = e.features[0];
      const parcel = {
        ...(feature.properties as CadastreParcel),
        geometry: feature.geometry as GeoJSON.Geometry,
      };
      if (!parcel.id) return;
      applySelection(toggleParcel(selectionRef.current, parcel));
    });

    // Without a listener, MapLibre's own fallback is to print any internal
    // error (WebGL context loss included) via console.error — which Sentry
    // captures as a tracked error. We already show dedicated recovery UI for
    // context loss below, and other internal errors (e.g. a tile request
    // failing) are non-fatal, so just log them quietly instead.
    instance.on('error', (e) => {
      console.warn('[MapLibreCadastre]', e.error?.message || e.error);
    });

    // Handle WebGL context loss — show a reload button
    instance.getCanvas().addEventListener('webglcontextlost', () => {
      setContextLost(true);
    });

    instance.getCanvas().addEventListener('webglcontextrestored', () => {
      setContextLost(false);
    });

    instance.addControl(new maplibregl.NavigationControl(), 'top-right');
    instance.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    // Marge explicite plutôt que de compter sur le CSS par défaut de
    // maplibre-gl (10px) : dans cette appli, il finit collé aux bords de la
    // carte, probablement écrasé par une règle plus tardive dans la cascade.
    instance.getContainer().querySelectorAll<HTMLElement>('.maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-left').forEach((el) => {
      el.style.margin = '12px';
    });
    map.current = instance;
  }, [lat, lon, applySelection]);

  // Un seul effet crée la carte, au montage — la doubler avec un second
  // useEffect qui rappelait initMap() détruisait et recréait le contexte
  // WebGL dans la même passe de rendu, ce que certains navigateurs/GPU
  // traduisent en perte de contexte immédiate ("Contexte WebGL perdu" dès
  // l'affichage, avant toute interaction).
  useEffect(() => {
    initMap();
    return () => {
      map.current?.remove();
      map.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le conteneur peut encore être en cours de mise en page au moment de la
  // création de la carte (onglet qui vient de s'activer, layout flex pas
  // encore stabilisé) : un resize() appelé pendant que sa taille mesurée est
  // encore fausse fige un cadrage incorrect (constaté : carte figée sur une
  // vue du pays entier). Un ResizeObserver redimensionne la carte à chaque
  // changement RÉEL de taille du conteneur, plutôt qu'après un délai fixe
  // deviné.
  useEffect(() => {
    if (!mapContainer.current) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(mapContainer.current);
    return () => observer.disconnect();
  }, []);

  // Un changement d'adresse ne fait que recentrer la carte existante,
  // jamais la recréer — mais pas au montage : la carte est déjà centrée sur
  // ce point initial par MAP_STYLE, un setCenter/resize immédiat ici ne fait
  // que dupliquer (et risquer de perturber) le cadrage initial.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!map.current) return;
    fittedParcel.current = false;
    // Nouvelle adresse, nouveau terrain : l'ancienne sélection n'a plus de sens.
    if (selectionRef.current.length > 0) applySelection([]);
    map.current.setCenter([lon, lat]);
    marker.current?.setLngLat([lon, lat]);
    fetchParcelles(map.current, [lon, lat]);
  }, [lat, lon, fetchParcelles, applySelection]);

  const handleReload = () => {
    setContextLost(false);
    initMap();
  };

  const handleParcelRetry = () => {
    if (!map.current) return;
    fetchParcelles(map.current, fittedParcel.current ? undefined : [lon, lat]);
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      {onSelectionChange && !contextLost && (
        <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-5rem)]">
          {selection.length > 0 ? (
            <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-700 shadow-md text-xs text-zinc-800 dark:text-zinc-100">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-dashed border-amber-500 shrink-0" />
              <span className="font-semibold truncate">
                {selection.length} parcelle{selection.length > 1 ? 's' : ''}
                {(() => {
                  const { surface } = summarizeParcels(selection);
                  return surface != null ? ` · ${formatSurface(surface)} au total` : '';
                })()}
              </span>
              <button
                type="button"
                onClick={() => applySelection([])}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                aria-label="Vider la sélection"
                title="Vider la sélection"
              >
                <IconX size={14} />
              </button>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-700 shadow-sm text-xs text-zinc-600 dark:text-zinc-300">
              Cliquez sur une ou plusieurs parcelles pour les sélectionner
            </div>
          )}
        </div>
      )}
      {zoom < CADASTRE_MIN_ZOOM && !contextLost && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-md" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
            Zoomez pour afficher le cadastre (niveau {CADASTRE_MIN_ZOOM}+)
          </div>
        </div>
      )}
      {zoom >= CADASTRE_MIN_ZOOM && parcelStatus === 'loading' && !contextLost && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-md" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
            Chargement du cadastre…
          </div>
        </div>
      )}
      {zoom >= CADASTRE_MIN_ZOOM && parcelStatus === 'error' && !contextLost && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={handleParcelRetry}
            className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
          >
            Cadastre indisponible — Réessayer
          </button>
        </div>
      )}
      {zoom >= CADASTRE_MIN_ZOOM && parcelStatus === 'empty' && !contextLost && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-md" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
            Limites IGN affichées — sélection vectorielle indisponible ici
          </div>
        </div>
      )}
      {contextLost && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/80 text-white text-sm gap-3 rounded-xl">
          <span>Contexte WebGL perdu</span>
          <button
            onClick={handleReload}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-bold transition-colors"
          >
            Recharger la carte
          </button>
        </div>
      )}
    </div>
  );
};
