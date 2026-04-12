import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const MapLibreCadastre = ({ lat, lon }: { lat: number; lon: number }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!map.current) return;
    map.current.setCenter([lon, lat]);
    if (marker.current) {
      marker.current.setLngLat([lon, lat]);
    }
    map.current.resize();
  }, [lat, lon]);

  useEffect(() => {
    if (map.current) return; // initialize map only once
    if (!mapContainer.current) return;

    // We use a custom style with OSM background and Cadastre raster overlay for maximum reliability
    // The previous vector style from data.geopf.fr was reported as not showing content.
    const style: any = {
      version: 8,
      sources: {
        'osm': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
        'cadastre': {
          type: 'raster',
          tiles: [
            'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
          ],
          tileSize: 256,
          attribution: '&copy; IGN',
        }
      },
      layers: [
        {
          id: 'osm-layer',
          type: 'raster',
          source: 'osm',
        },
        {
          id: 'cadastre-layer',
          type: 'raster',
          source: 'cadastre',
          paint: {
            'raster-opacity': 0.7
          }
        }
      ]
    };

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: style,
      center: [lon, lat],
      zoom: 17,
      maxZoom: 19,
      minZoom: 5
    });

    map.current.on('load', () => {
      if (!map.current) return;

      // Add a marker to show the exact location
      marker.current = new maplibregl.Marker({
        color: '#3b82f6', // blue-500
        scale: 0.8
      })
        .setLngLat([lon, lat])
        .addTo(map.current);

      // Force a resize after load to ensure it fills the container
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
