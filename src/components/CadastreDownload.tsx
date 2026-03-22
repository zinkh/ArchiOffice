import React, { useState, useEffect } from 'react';
import { IconDownload, IconFileTypePdf, IconMap, IconAlertCircle, IconExternalLink, IconRefresh, IconFileCode } from '@tabler/icons-react';
import { UrbanPlanningInfo } from './UrbanPlanningInfo';
import { HistoricalMonuments } from './HistoricalMonuments';

interface CadastreDownloadProps {
  address: string;
}

interface ParcelInfo {
  id: string;
  commune: string;
  insee: string;
  prefixe: string;
  section: string;
  numero: string;
  surface?: number;
}

export function CadastreDownload({ address }: CadastreDownloadProps) {
  const [parcel, setParcel] = useState<ParcelInfo | null>(null);
  const [coords, setCoords] = useState<{lat: number, lon: number} | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState('');

  const fetchParcel = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Geocode address to get coordinates
      const geoRes = await fetch(`/api/address-search?q=${encodeURIComponent(address)}`);
      if (!geoRes.ok) throw new Error('Geocoding failed');
      
      const geoData = await geoRes.json();
      if (!geoData.features?.length) {
        setError('Address not found');
        setLoading(false);
        return;
      }

      const [lon, lat] = geoData.features[0].geometry.coordinates;
      setCoords({ lat, lon });
      const insee = geoData.features[0].properties.citycode;

      // 2. Get parcel ID from coordinates using our backend proxy to avoid CORS
      const parcelRes = await fetch(`/api/cadastre/parcel?lon=${lon}&lat=${lat}`);
      if (!parcelRes.ok) {
        let errorMsg = `Parcel lookup failed (Status: ${parcelRes.status})`;
        try {
          const contentType = parcelRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorData = await parcelRes.json();
            errorMsg = errorData.error || errorMsg;
          } else {
            const text = await parcelRes.text();
            if (text && text.length < 100) errorMsg = text;
          }
        } catch (e) {
          // Ignore parse errors
        }
        throw new Error(errorMsg);
      }
      
      const contentType = parcelRes.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Cadastre API returned invalid response format');
      }

      const parcelData = await parcelRes.json();
      if (parcelData.features?.length > 0) {
        const p = parcelData.features[0].properties;
        setParcel({
          id: p.id,
          commune: p.commune || insee,
          insee: p.insee || insee,
          prefixe: p.prefixe || '000',
          section: p.section,
          numero: p.numero,
          surface: p.contenance
        });
      } else {
        setError('No parcel found at this location');
      }
    } catch (err: any) {
      console.error('Cadastre API error:', err);
      setError(`Could not retrieve cadastre info: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!address || address.length < 10) {
      setParcel(null);
      return;
    }

    const timer = setTimeout(fetchParcel, 1000);
    return () => clearTimeout(timer);
  }, [address, retryCount]);

  if (!address || address.length < 10) return null;

  return (
    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded uppercase tracking-wider">Cadastre Download</span>
        </div>
        {loading && <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>}
      </div>

      {error ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <IconAlertCircle size={14} />
            <span>{error}</span>
          </div>
          <button 
            onClick={() => setRetryCount(c => c + 1)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <IconRefresh size={14} />
            Retry Lookup
          </button>
        </div>
      ) : parcel ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-zinc-900 dark:text-white">Parcel {parcel.id}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Section {parcel.section} - N° {parcel.numero}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <a 
              href={`https://cadastre.data.gouv.fr/bundler/pci-image/communes/${parcel.commune}/tiff`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconFileTypePdf size={16} className="text-red-500" />
              TIFF Image (Commune)
            </a>
            <a 
              href={`https://www.cadastre.gouv.fr/scpc/rechercherParcelle.do?codeDepartement=${parcel.commune.startsWith('97') || parcel.commune.startsWith('98') ? parcel.commune.substring(0, 3) : parcel.commune.substring(0, 2)}&codeCommune=${parcel.commune.startsWith('97') || parcel.commune.startsWith('98') ? parcel.commune.substring(3) : parcel.commune.substring(2)}&prefixe=${parcel.prefixe}&section=${parcel.section}&numero=${parcel.numero}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconExternalLink size={16} className="text-blue-600" />
              Official Site (PDF)
            </a>
            <a 
              href={`https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${parcel.commune}/shp/parcelles`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconDownload size={16} className="text-zinc-500" />
              SHP (Parcelles)
            </a>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(parcel.id);
                alert('Parcel ID copied: ' + parcel.id);
              }}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconRefresh size={14} className="text-zinc-400" />
              Copy ID
            </button>
            <a 
              href={`https://cadastre.data.gouv.fr/bundler/pci-vecteur/communes?format=dxf&insee_codes=${parcel.commune}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconFileCode size={16} className="text-orange-600" />
              DXF (Commune ZIP)
            </a>
            <a 
              href={`https://cadastre.data.gouv.fr/bundler/pci-vecteur/feuilles/${parcel.id.substring(0, 10)}01/dxf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconFileCode size={16} className="text-orange-500" />
              DXF (Sheet ZIP)
            </a>
            <a 
              href={`https://cadastre.data.gouv.fr/carte?commune=${parcel.insee}#18/${coords?.lat}/${coords?.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
            >
              <IconMap size={16} />
              Interactive Map (Official)
            </a>
            <a 
              href={`https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${parcel.commune}/geojson/parcelles`}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconMap size={16} className="text-blue-500" />
              GeoJSON (Commune ZIP)
            </a>
            <a 
              href={`https://cadastre.data.gouv.fr/bundler/pci-image/communes/${parcel.commune}/tiff`}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconDownload size={16} className="text-zinc-500" />
              TIFF Images (Commune ZIP)
            </a>
            <a 
              href={`https://www.geoportail.gouv.fr/carte?c=${coords?.lon},${coords?.lat}&z=19&l0=CADASTRALPARCELS.PARCELS::GEOPORTAIL:G:WMTS(1)&permalink=yes`}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconMap size={16} className="text-emerald-600" />
              View on Geoportail
            </a>
            <a 
              href={`https://cadastre.data.gouv.fr/datasets/plan-cadastral-informatise/communes/${parcel.commune}`}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <IconExternalLink size={16} className="text-zinc-500" />
              All Commune Files
            </a>
            <button 
              onClick={() => {
                const url = `https://cadastre.data.gouv.fr/bundler/pci-vecteur/communes/${parcel.commune}/dxf`;
                navigator.clipboard.writeText(url);
                alert('Commune DXF link copied');
              }}
              className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              <IconRefresh size={14} />
              Copy DXF Direct Link
            </button>
            {coords && (
              <a 
                href={`https://rnb.beta.gouv.fr/carte?coords=${coords.lat}%2C${coords.lon}%2C20.00`}
                target="_blank"
                rel="noopener noreferrer"
                className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <IconExternalLink size={16} className="text-emerald-500" />
                View on RNB (Bâtiments)
              </a>
            )}
          </div>
          <p className="text-[10px] text-zinc-400 italic">Source: cadastre.data.gouv.fr (Bundler API)</p>
          <p className="text-[9px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50 p-2 rounded border border-zinc-100 dark:border-zinc-800">
            Note: We are now using the official Bundler API. Vector data (DXF, SHP) and images (TIFF) are provided as ZIP archives for the commune or sheet.
          </p>
          
          <UrbanPlanningInfo insee={parcel.insee} coords={coords} />
          
          {coords && <HistoricalMonuments lat={coords.lat} lon={coords.lon} />}
        </div>
      ) : !loading && (
        <p className="text-xs text-zinc-400 italic">Searching for parcel information...</p>
      )}
    </div>
  );
}
