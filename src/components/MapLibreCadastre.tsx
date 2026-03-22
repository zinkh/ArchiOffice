import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const MapLibreCadastre = ({ lat, lon }: { lat: number; lon: number }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!map.current) return;
    map.current.setCenter([lon, lat]);
    map.current.resize();
  }, [lat, lon]);

  useEffect(() => {
    if (map.current) return; // initialize map only once
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          }
        ],
      },
      center: [lon, lat],
      zoom: 18,
    });

    map.current.on('load', () => {
      setTimeout(() => map.current?.resize(), 100);
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  return <div ref={mapContainer} className="w-full h-full" />;
};
