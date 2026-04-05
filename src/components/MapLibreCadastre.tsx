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

    // Official Cadastre style from cadastre.data.gouv.fr
    const styleUrl = 'https://openmaptiles.geo.data.gouv.fr/styles/cadastre/style.json';

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [lon, lat],
      zoom: 18,
      maxZoom: 20,
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
