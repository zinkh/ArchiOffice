import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
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

const MAP_STYLE = (lon: number, lat: number): any => ({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
    parcelles: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      generateId: true,
    },
  },
  layers: [
    { id: 'osm-layer', type: 'raster', source: 'osm' },
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
  zoom: 17,
});

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
  const [zoom, setZoom] = useState(17);
  const hoveredId = useRef<number | string | null>(null);
  const selectedId = useRef<number | string | null>(null);
  const fetchAbort = useRef<AbortController | null>(null);
  const onParcelSelectRef = useRef(onParcelSelect);
  onParcelSelectRef.current = onParcelSelect;

  const fetchParcelles = useCallback((instance: maplibregl.Map) => {
    if (instance.getZoom() < CADASTRE_MIN_ZOOM) return;
    const source = instance.getSource('parcelles') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    fetchAbort.current?.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;

    const b = instance.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');

    fetch(`/api/cadastre/parcel?bbox=${bbox}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.features) source.setData(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.warn('[MapLibreCadastre] parcel fetch failed', err);
      });
  }, []);

  const initMap = useCallback(() => {
    if (!mapContainer.current) return;

    map.current?.remove();
    map.current = null;
    marker.current = null;

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
      setTimeout(() => instance.resize(), 100);
      fetchParcelles(instance);
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
    map.current = instance;
  }, [lat, lon]);

  useEffect(() => {
    if (map.current) {
      map.current.setCenter([lon, lat]);
      marker.current?.setLngLat([lon, lat]);
      map.current.resize();
      return;
    }
    initMap();
  }, [lat, lon, initMap]);

  useEffect(() => {
    initMap();
    return () => {
      map.current?.remove();
      map.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReload = () => {
    setContextLost(false);
    initMap();
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
