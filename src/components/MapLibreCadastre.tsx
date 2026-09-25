import { useEffect, useRef, useState, useCallback } from 'react';
// maplibre-gl 6 dropped the default export (named exports only) — this
// namespace import keeps every existing maplibregl.Map/.Marker/... call
// site below unchanged.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const CADASTRE_MIN_ZOOM = 13;

export interface CadastreParcel {
  id: string;
  section: string;
  numero: string;
  prefixe: string;
  commune: string;
  insee: string;
  contenance?: number;
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
        'fill-color': '#3b82f6',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 0.35,
          ['boolean', ['feature-state', 'hover'], false], 0.2,
          0.05,
        ],
      },
    },
    {
      id: 'parcelles-line',
      type: 'line',
      source: 'parcelles',
      minzoom: CADASTRE_MIN_ZOOM,
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#f59e0b', '#3b82f6'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 1],
      },
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

export const MapLibreCadastre = ({
  lat,
  lon,
  onParcelSelect,
}: {
  lat: number;
  lon: number;
  onParcelSelect?: (parcel: CadastreParcel) => void;
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [zoom, setZoom] = useState(19);
  const [parcelStatus, setParcelStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const hoveredId = useRef<number | string | null>(null);
  const selectedId = useRef<number | string | null>(null);
  const fetchAbort = useRef<AbortController | null>(null);
  const onParcelSelectRef = useRef(onParcelSelect);
  onParcelSelectRef.current = onParcelSelect;
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

    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE(lon, lat),
      maxZoom: 19,
      minZoom: 5,
    });

    instance.on('load', () => {
      marker.current = new maplibregl.Marker({ color: '#3b82f6', scale: 0.8 })
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
      instance.getCanvas().style.cursor = 'pointer';
    });

    instance.on('mouseleave', 'parcelles-fill', () => {
      if (hoveredId.current !== null) {
        instance.setFeatureState({ source: 'parcelles', id: hoveredId.current }, { hover: false });
        hoveredId.current = null;
      }
      instance.getCanvas().style.cursor = '';
    });

    instance.on('click', 'parcelles-fill', (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      const id = feature.id;
      if (id === undefined) return;
      if (selectedId.current !== null) {
        instance.setFeatureState({ source: 'parcelles', id: selectedId.current }, { selected: false });
      }
      selectedId.current = id;
      instance.setFeatureState({ source: 'parcelles', id }, { selected: true });
      onParcelSelectRef.current?.(feature.properties as CadastreParcel);
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

    instance.addControl(new maplibregl.NavigationControl(), 'top-left');
    instance.addControl(new maplibregl.ScaleControl(), 'bottom-right');
    // Marge explicite plutôt que de compter sur le CSS par défaut de
    // maplibre-gl (10px) : dans cette appli, il finit collé aux bords de la
    // carte, probablement écrasé par une règle plus tardive dans la cascade.
    instance.getContainer().querySelectorAll<HTMLElement>('.maplibregl-ctrl-top-left, .maplibregl-ctrl-bottom-right').forEach((el) => {
      el.style.margin = '12px';
    });
    map.current = instance;
  }, [lat, lon]);

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
    map.current.setCenter([lon, lat]);
    marker.current?.setLngLat([lon, lat]);
    fetchParcelles(map.current, [lon, lat]);
  }, [lat, lon, fetchParcelles]);

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
