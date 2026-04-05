import { useState, useEffect } from 'react';
import { MapLibreCadastre } from './MapLibreCadastre';
import { cn } from '../lib/utils';

export const GeoportailMap = ({ address, banId }: { address: string; banId?: string }) => {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if ((!address || address.length < 5) && !banId) return;
    
    const fetchCoords = async () => {
      setLoading(true);
      setError('');
      try {
        const queryParams = new URLSearchParams();
        if (banId) queryParams.append('banId', banId);
        if (address) queryParams.append('q', address);
        queryParams.append('limit', '1');

        const res = await fetch(`/api/address-search?${queryParams.toString()}`);
        if (res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            if (data.features && data.features.length > 0) {
              const [lon, lat] = data.features[0].geometry.coordinates;
              setCoords({ lat, lon });
            } else {
              setError('Address not found');
            }
          } else {
            setError('Invalid response from geocoder');
          }
        } else {
          setError('Failed to geocode address');
        }
      } catch (err) {
        console.error(err);
        setError('Error fetching coordinates');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchCoords, 1000); // Reduced debounce to 1s
    return () => clearTimeout(timer);
  }, [address, banId]);

  if (loading) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Loading map...</div>;
  if (error) return <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">{error}</div>;
  if (!coords) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Enter a valid address to see the map</div>;

  return <MapLibreCadastre lat={coords.lat} lon={coords.lon} />;
};

export const GoogleMap = ({ address }: { address: string }) => {
  const [debouncedAddress, setDebouncedAddress] = useState(address);

  useEffect(() => {
    // If address is very short, don't update immediately to avoid rapid iframe reloads
    if (address.length < 5) return;

    const timer = setTimeout(() => {
      setDebouncedAddress(address);
    }, 1500); // 1.5s delay to allow typing

    return () => clearTimeout(timer);
  }, [address]);

  // Only show map if we have a valid debounced address
  if (!debouncedAddress || debouncedAddress.length < 5) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Enter a valid address to see the map</div>;

  return (
    <iframe
      src={`https://maps.google.com/maps?q=${encodeURIComponent(debouncedAddress)}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
      className="w-full h-full border-0"
      title="Google Map"
      loading="lazy"
      allow="geolocation"
    />
  );
};

export const GeorisquesMap = ({ address, banId }: { address: string; banId?: string }) => {
  const [addressDetails, setAddressDetails] = useState<{ 
    lat: number; 
    lon: number; 
    city: string; 
    codeInsee: string; 
    adresse: string; 
    commune: string; 
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if ((!address || address.length < 5) && !banId) return;
    
    const fetchCoords = async () => {
      setLoading(true);
      setError('');
      try {
        const queryParams = new URLSearchParams();
        if (banId) queryParams.append('banId', banId);
        if (address) queryParams.append('q', address);
        queryParams.append('limit', '1');

        const res = await fetch(`/api/address-search?${queryParams.toString()}`);
        if (res.ok) {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            if (data.features && data.features.length > 0) {
              const feature = data.features[0];
              const [lon, lat] = feature.geometry.coordinates;
              setAddressDetails({ 
                lat, 
                lon,
                city: feature.properties.city,
                codeInsee: feature.properties.citycode,
                adresse: feature.properties.label,
                commune: feature.properties.city || feature.properties.name
              });
            } else {
              setError('Address not found');
            }
          } else {
            setError('Invalid response from geocoder');
          }
        }
      } catch (err) {
        console.error(err);
        setError('Error fetching coordinates');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchCoords, 1000);
    return () => clearTimeout(timer);
  }, [address, banId]);

  if (loading) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Loading risks...</div>;
  if (error) return <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">{error}</div>;
  if (!addressDetails) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Enter a valid address</div>;

  const georisquesUrl = `https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2?form-adresse=true&isCadastre=false&city=${encodeURIComponent(addressDetails.city)}&type=adresse&typeForm=adresse&codeInsee=${addressDetails.codeInsee}&lon=${addressDetails.lon}&lat=${addressDetails.lat}&go_back=/&propertiesType=housenumber&adresse=${encodeURIComponent(addressDetails.adresse)}&longitude=${addressDetails.lon}&latitude=${addressDetails.lat}&commune=${encodeURIComponent(addressDetails.commune)}`;

  // Georisques blocks iframing of their site for security reasons.
  // Instead of an iframe, we provide a clear link to open the report in a new window.
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800">
      <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-2">Georisques Report</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center mb-6 max-w-xs">
        For security reasons, Georisques does not allow its report to be embedded. Click below to view the full natural risk analysis for this address.
      </p>
      <a
        href={georisquesUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-red-500/20"
      >
        Open Georisques Report
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
};

export const GeorisquesInfo = ({ address, banId }: { address: string; banId?: string }) => {
  const [risks, setRisks] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if ((!address || address.length < 10) && !banId) return;

    const fetchRisks = async () => {
      setLoading(true);
      setError('');
      try {
        const queryParams = new URLSearchParams();
        if (banId) queryParams.append('banId', banId);
        if (address) queryParams.append('q', address);
        queryParams.append('limit', '1');

        // First geocode to get lat/lon using our local proxy
        const geoRes = await fetch(`/api/address-search?${queryParams.toString()}`);
        if (!geoRes.ok) throw new Error('Geocoding failed');
        
        const contentType = geoRes.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Invalid response from geocoder');
        }
        
        const geoData = await geoRes.json();
        if (!geoData.features?.length) throw new Error('Address not found');
        
        const [lon, lat] = geoData.features[0].geometry.coordinates;
        
        // Then fetch risks from our local proxy API
        const res = await fetch(`/api/georisques?latitude=${lat}&longitude=${lon}&code_insee=${geoData.features[0].properties.citycode}`);
        if (res.ok) {
          const resContentType = res.headers.get('content-type');
          if (resContentType && resContentType.includes('application/json')) {
            const data = await res.json();
            setRisks(data);
          } else {
            setError('Invalid response from Georisques API');
          }
        } else {
          try {
            const errorData = await res.json();
            setError(errorData.error || `Georisques API Error (${res.status})`);
          } catch (e) {
            setError(`Georisques API Error (${res.status})`);
          }
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Error fetching risks');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRisks, 1500);
    return () => clearTimeout(timer);
  }, [address, banId]);

  if (!address || address.length < 10) return null;
  if (loading) return <div className="text-xs text-zinc-500 animate-pulse">Fetching risk data...</div>;
  if (error) return <div className="text-xs text-red-500">{error}</div>;
  if (!risks) return null;

  return (
    <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] font-bold rounded uppercase tracking-wider">Risks Summary (API)</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-400 uppercase font-bold">Natural Risks</span>
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
            {risks.count || 0} identified
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-400 uppercase font-bold">Last Update</span>
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
            {new Date().toLocaleDateString('fr-FR')}
          </span>
        </div>
      </div>
      {risks.data && risks.data.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex flex-wrap gap-1">
            {risks.data?.slice(0, 5).map((r: any, i: number) => (
              <span key={i} className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[9px] rounded border border-zinc-200 dark:border-zinc-700 uppercase tracking-tight">
                {r.libelle_risque_naturel || r.type_risque}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const BDNBInfo = ({ address, banId, cityCode }: { address: string; banId?: string; cityCode?: string }) => {
  const [buildings, setBuildings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!address || address.length < 10) return;

    const fetchBDNB = async () => {
      setLoading(true);
      setError('');
      try {
        let currentBanId = banId;
        
        // If we don't have a banId or if we want to be sure to use the BDNB-compatible one,
        // we call the BDNB geocoder first via our unified address-search endpoint.
        if (address && address.length >= 10) {
          try {
            const geoRes = await fetch(`/api/address-search?q=${encodeURIComponent(address)}&limit=1`);
            if (geoRes.ok) {
              const contentType = geoRes.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                const geoData = await geoRes.json();
                // The unified geocoder returns GeoJSON features.
                if (geoData.features && geoData.features.length > 0 && geoData.features[0].properties.id) {
                  currentBanId = geoData.features[0].properties.id;
                  console.log(`BDNB Geocoder found cle_interop_adr: ${currentBanId}`);
                }
              }
            }
          } catch (geoErr) {
            console.error("Error with BDNB geocoder, falling back to provided banId or fuzzy search", geoErr);
          }
        }

        const queryParams = new URLSearchParams();
        if (currentBanId) queryParams.append('banId', currentBanId);
        if (cityCode) queryParams.append('cityCode', cityCode);
        queryParams.append('q', address);
        
        const res = await fetch(`/api/bdnb?${queryParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setBuildings(data || []);
        } else {
          setError(`BDNB API Error (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        setError('Error connecting to BDNB API');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchBDNB, 2000);
    return () => clearTimeout(timer);
  }, [address]);

  if (!address || address.length < 10) return null;
  if (loading) return <div className="text-xs text-zinc-500 animate-pulse">Searching BDNB database...</div>;
  if (error) return <div className="text-xs text-red-500">{error}</div>;
  if (buildings.length === 0) return <div className="text-xs text-zinc-400 italic">No building found in BDNB for this address.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[10px] font-bold rounded uppercase tracking-wider">BDNB Buildings</span>
      </div>
      <div className="space-y-3">
        {buildings.map((b: any) => (
          <div key={b.batiment_groupe_id} className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <div className="flex flex-col">
                <span className="text-sm font-mono font-bold text-purple-600 dark:text-purple-400">
                  {b.batiment_groupe_id}
                </span>
                <span className="text-[10px] text-zinc-400 uppercase font-bold mt-1">
                  {b.usage_principal_bdnb_open || 'Usage inconnu'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex flex-col">
                <span className="text-[9px] text-zinc-400 uppercase font-bold">Construction</span>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{b.annee_construction || 'N/A'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] text-zinc-400 uppercase font-bold">DPE</span>
                <span className={cn(
                  "text-xs font-bold px-1.5 py-0.5 rounded w-fit",
                  b.classe_bilan_dpe === 'A' ? "bg-green-100 text-green-700" :
                  b.classe_bilan_dpe === 'B' ? "bg-green-50 text-green-600" :
                  b.classe_bilan_dpe === 'C' ? "bg-lime-50 text-lime-600" :
                  b.classe_bilan_dpe === 'D' ? "bg-yellow-50 text-yellow-600" :
                  b.classe_bilan_dpe === 'E' ? "bg-orange-50 text-orange-600" :
                  b.classe_bilan_dpe === 'F' ? "bg-red-50 text-red-600" :
                  b.classe_bilan_dpe === 'G' ? "bg-red-100 text-red-700" :
                  "bg-zinc-100 text-zinc-500"
                )}>
                  {b.classe_bilan_dpe || 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const RNBInfo = ({ address }: { address: string }) => {
  const [buildings, setBuildings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!address || address.length < 10) return;

    const fetchRNB = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/rnb-buildings?q=${encodeURIComponent(address)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'geocoding_no_result') {
            setBuildings([]);
          } else if (data.status === 'geocoding_score_is_too_low') {
            // Instead of error, we can show a warning or just empty results
            console.warn('Address match score too low for RNB.');
            setBuildings([]);
          } else {
            setBuildings(data.results || []);
          }
        } else if (res.status === 429) {
          setError('RNB API quota exceeded. Please wait.');
        } else {
          setError(`RNB API Error (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        setError('Error connecting to RNB API');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRNB, 2000);
    return () => clearTimeout(timer);
  }, [address]);

  if (!address || address.length < 10) return null;
  if (loading) return <div className="text-xs text-zinc-500 animate-pulse">Searching RNB database...</div>;
  if (error) return <div className="text-xs text-red-500">{error}</div>;
  if (buildings.length === 0) return <div className="text-xs text-zinc-400 italic">No building found in RNB for this address.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-bold rounded uppercase tracking-wider">RNB Buildings Found</span>
      </div>
      <div className="space-y-3">
        {buildings.map((b: any) => (
          <div key={b.rnb_id} className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <div className="flex flex-col">
                <a 
                  href={`https://rnb.beta.gouv.fr/carte?q=${b.rnb_id}&coords=${b.point?.coordinates[1]}%2C${b.point?.coordinates[0]}%2C20.00`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  {b.rnb_id}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                </a>
                <span className={`text-[10px] uppercase font-bold mt-1 ${b.status === 'constructed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {b.status}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${b.is_active ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-red-100 dark:bg-red-900/30 text-red-600'}`}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            
            {b.addresses && b.addresses.length > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] text-zinc-400 uppercase font-bold mb-1">Registered Addresses</p>
                <div className="space-y-1">
                  {b.addresses.map((addr: any, idx: number) => (
                    <p key={idx} className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                      <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-600 rounded-full"></span>
                      {addr.street_number} {addr.street}, {addr.city_zipcode} {addr.city_name}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
