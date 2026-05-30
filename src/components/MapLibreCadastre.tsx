import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE = (lon: number, lat: number): any => ({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
    cadastre: {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      ],
      tileSize: 256,
      attribution: '&copy; IGN',
    },
  },
  layers: [
    { id: 'osm-layer', type: 'raster', source: 'osm' },
    { id: 'cadastre-layer', type: 'raster', source: 'cadastre', paint: { 'raster-opacity': 0.7 } },
  ],
  center: [lon, lat],
  zoom: 17,
});

export const MapLibreCadastre = ({ lat, lon }: { lat: number; lon: number }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [contextLost, setContextLost] = useState(false);

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
      setTimeout(() => instance.resize(), 100);
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
