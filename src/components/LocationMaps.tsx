import { useState, useEffect } from 'react';
import { MapLibreCadastre, CadastreParcel } from './MapLibreCadastre';
import { cn } from '../lib/utils';

export const GeoportailMap = ({
  address,
  banId,
  onSelectionChange,
  selection,
}: {
  address: string;
  banId?: string;
  onSelectionChange?: (parcels: CadastreParcel[]) => void;
  /** Sélection tenue par l'écran hôte, reportée sur la carte (voir MapLibreCadastre). */
  selection?: CadastreParcel[];
}) => {
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
              setError('Adresse introuvable');
            }
          } else {
            setError('Réponse invalide du géocodeur');
          }
        } else {
          setError('Échec du géocodage de l’adresse');
        }
      } catch (err) {
        console.error(err);
        setError('Erreur lors de la récupération des coordonnées');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchCoords, 1000); // Reduced debounce to 1s
    return () => clearTimeout(timer);
  }, [address, banId]);

  // Une carte déjà affichée reste montée pendant qu'une nouvelle adresse se géocode :
  // la démonter ferait perdre la vue et la sélection de parcelles.
  if (loading && !coords) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Chargement de la carte...</div>;
  if (error) return <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">{error}</div>;
  if (!coords) return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Enter a valid address to see the map</div>;

  return <MapLibreCadastre lat={coords.lat} lon={coords.lon} onSelectionChange={onSelectionChange} selection={selection} />;
};

export const GoogleMap = ({ address }: { address: string }) => {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || address.length < 5) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/address-search?q=${encodeURIComponent(address)}&limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.features?.length > 0) {
          const [lon, lat] = data.features[0].geometry.coordinates;
          setCoords({ lat, lon });
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [address]);

  if (!address || address.length < 5)
    return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Entrez une adresse valide</div>;
  if (loading)
    return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Chargement...</div>;
  if (!coords)
    return <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Adresse introuvable</div>;

  const delta = 0.003;
  const bbox = `${coords.lon - delta},${coords.lat - delta},${coords.lon + delta},${coords.lat + delta}`;
  return (
    <iframe
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat},${coords.lon}`}
      className="w-full h-full border-0"
      title="OpenStreetMap"
      loading="lazy"
    />
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
        if (!geoRes.ok) throw new Error('Échec du géocodage');
        
        const contentType = geoRes.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Réponse invalide du géocodeur');
        }
        
        const geoData = await geoRes.json();
        if (!geoData.features?.length) throw new Error('Adresse introuvable');
        
        const [lon, lat] = geoData.features[0].geometry.coordinates;
        
        // Then fetch risks from our local proxy API
        const res = await fetch(`/api/georisques?latitude=${lat}&longitude=${lon}&code_insee=${geoData.features[0].properties.citycode}`);
        if (res.ok) {
          const resContentType = res.headers.get('content-type');
          if (resContentType && resContentType.includes('application/json')) {
            const data = await res.json();
            setRisks(data);
          } else {
            setError('Réponse invalide de l’API Géorisques');
          }
        } else {
          try {
            const errorData = await res.json();
            setError(errorData.error || `Erreur de l’API Géorisques (${res.status})`);
          } catch (e) {
            setError(`Erreur de l’API Géorisques (${res.status})`);
          }
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erreur lors de la récupération des risques');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRisks, 1500);
    return () => clearTimeout(timer);
  }, [address, banId]);

  if (!address || address.length < 10) return null;
  if (loading) return <div className="text-xs text-zinc-500 animate-pulse">Récupération des risques...</div>;
  // Le service public Géorisques expire régulièrement (504) : un code
  // d'erreur brut n'apprend rien à l'architecte, un lien vers le site oui.
  if (error) return (
    <div className="text-xs text-zinc-500 dark:text-zinc-400">
      Service Géorisques momentanément indisponible.{' '}
      <a href="https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
        Consulter georisques.gouv.fr
      </a>
    </div>
  );
  if (!risks) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[0.6875rem] font-bold rounded uppercase tracking-wider">Synthèse des risques (API)</span>
        {risks.url && (
          <a 
            href={risks.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[0.6875rem] text-zinc-400 hover:text-red-500 flex items-center gap-1 transition-colors"
          >
            Rapport complet
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
      <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col">
            <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Risques naturels</span>
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              {risks.risques_naturels?.length || 0} identifié(s)
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Risques technologiques</span>
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              {risks.risques_technologiques?.length || 0} identifié(s)
            </span>
          </div>
        </div>
        
        {(risks.risques_naturels?.length > 0 || risks.risques_technologiques?.length > 0) && (
          <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex flex-wrap gap-1">
              {risks.risques_naturels?.map((r: string, i: number) => (
                <span key={`nat-${i}`} className="px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-[0.6875rem] rounded border border-red-100 dark:border-red-900/30 uppercase tracking-tight">
                  {r}
                </span>
              ))}
              {risks.risques_technologiques?.map((r: string, i: number) => (
                <span key={`tech-${i}`} className="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[0.6875rem] rounded border border-amber-100 dark:border-amber-900/30 uppercase tracking-tight">
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
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
          setError(`Erreur de l’API BDNB (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        setError('Erreur de connexion à l’API BDNB');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchBDNB, 2000);
    return () => clearTimeout(timer);
  }, [address]);

  if (!address || address.length < 10) return null;
  if (loading) return <div className="text-xs text-zinc-500 animate-pulse">Recherche dans la base BDNB...</div>;
  if (error) return <div className="text-xs text-red-500">{error}</div>;
  if (buildings.length === 0) return <div className="text-xs text-zinc-400 italic">Aucun bâtiment trouvé dans la BDNB pour cette adresse.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[0.6875rem] font-bold rounded uppercase tracking-wider">Bâtiments BDNB</span>
      </div>
      <div className="space-y-3">
        {buildings.map((b: any) => (
          <div key={b.batiment_groupe_id} className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <div className="flex flex-col">
                <a 
                  href={`https://gorenove.fr/adresse?id=${b.batiment_groupe_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-mono font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                  title="Voir sur GoRenove"
                >
                  {b.batiment_groupe_id}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold mt-1">
                  {b.usage_principal_bdnb_open || 'Usage inconnu'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Construction</span>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{b.annee_construction || 'N/A'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">DPE</span>
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
              
              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Usage</span>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 truncate" title={b.categorie_usage_propriete}>
                  {b.categorie_usage_propriete || 'N/A'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Logements / Niveaux</span>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  {b.nb_log || 0} log. / {b.nb_niveau || 0} niv.
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Hauteur / Altitude</span>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  {b.hauteur_mean ? `${Math.round(b.hauteur_mean)}m` : 'N/A'} / {b.altitude_sol_mean ? `${Math.round(b.altitude_sol_mean)}m` : 'N/A'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Immat. copropriété</span>
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 truncate">
                  {b.numero_immat_principal || 'N/A'}
                </span>
              </div>

              <div className="col-span-2 space-y-2 mt-1">
                <div className="flex flex-col">
                  <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Systèmes</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {b.type_generateur_chauffage && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[0.6875rem] rounded border border-zinc-200 dark:border-zinc-700 uppercase">
                        Chauffage: {b.type_generateur_chauffage}
                      </span>
                    )}
                    {b.type_generateur_ecs && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[0.6875rem] rounded border border-zinc-200 dark:border-zinc-700 uppercase">
                        ECS: {b.type_generateur_ecs} ({b.type_installation_ecs || 'N/A'})
                      </span>
                    )}
                    {b.type_ventilation && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[0.6875rem] rounded border border-zinc-200 dark:border-zinc-700 uppercase">
                        VMC: {b.type_ventilation}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col">
                  <span className="text-[0.6875rem] text-zinc-400 uppercase font-bold">Isolation</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {b.type_isolation_mur_exterieur && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[0.6875rem] rounded border border-zinc-200 dark:border-zinc-700 uppercase">
                        Murs: {b.type_isolation_mur_exterieur}
                      </span>
                    )}
                    {b.type_isolation_plancher_haut && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[0.6875rem] rounded border border-zinc-200 dark:border-zinc-700 uppercase">
                        Toit: {b.type_isolation_plancher_haut} ({b.type_plancher_haut_deperditif || 'N/A'})
                      </span>
                    )}
                    {b.type_plancher_bas_deperditif && (
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[0.6875rem] rounded border border-zinc-200 dark:border-zinc-700 uppercase">
                        Sol: {b.type_plancher_bas_deperditif}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const RNB_STATUS_LABELS: Record<string, string> = {
  constructed: 'Construit',
  inUse: 'En service',
  notUsable: 'Hors d’usage',
  demolished: 'Démoli',
  constructionProject: 'En projet',
  canceledConstructionProject: 'Projet abandonné',
  ongoingConstruction: 'En construction',
  ongoingChange: 'En transformation',
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
          setError('Quota de l’API RNB dépassé. Veuillez patienter.');
        } else {
          setError(`Erreur de l’API RNB (${res.status})`);
        }
      } catch (err) {
        console.error(err);
        setError('Erreur de connexion à l’API RNB');
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRNB, 2000);
    return () => clearTimeout(timer);
  }, [address]);

  if (!address || address.length < 10) return null;
  if (loading) return <div className="text-xs text-zinc-500 animate-pulse">Recherche dans la base RNB...</div>;
  if (error) return <div className="text-xs text-red-500">{error}</div>;
  if (buildings.length === 0) return <div className="text-xs text-zinc-400 italic">Aucun bâtiment trouvé dans le RNB pour cette adresse.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[0.6875rem] font-bold rounded uppercase tracking-wider">Bâtiments RNB trouvés</span>
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
                <span className={`text-[0.6875rem] uppercase font-bold mt-1 ${b.status === 'constructed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {RNB_STATUS_LABELS[b.status] || b.status}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className={`text-[0.6875rem] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${b.is_active ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-red-100 dark:bg-red-900/30 text-red-600'}`}>
                  {b.is_active ? 'Actif' : 'Inactif'}
                </span>
              </div>
            </div>
            
            {b.addresses && b.addresses.length > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[0.6875rem] text-zinc-400 uppercase font-bold mb-1">Adresses enregistrées</p>
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
