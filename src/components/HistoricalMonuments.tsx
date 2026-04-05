import React, { useState, useEffect } from 'react';
import { IconBuildingCommunity, IconMapPin, IconExternalLink, IconLoader2, IconAlertCircle, IconHistory } from '@tabler/icons-react';

interface Monument {
  recordid: string;
  fields: {
    tico: string; // Titre
    comm: string; // Commune
    dpt: string;  // Département
    stat: string; // Statut (Classé, Inscrit)
    coordonnees_ban?: [number, number];
    prec_lib?: string; // Précision sur la protection
    ref_merimee?: string; // Référence Mérimée
    dpro?: string; // Date de protection
    autr?: string[]; // Auteurs
    dist?: string; // Distance calculée par l'API
  };
}

interface HistoricalMonumentsProps {
  lat: number;
  lon: number;
}

export function HistoricalMonuments({ lat, lon }: HistoricalMonumentsProps) {
  const [monuments, setMonuments] = useState<Monument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!lat || !lon) return;

    const fetchMonuments = async () => {
      setLoading(true);
      setError('');
      try {
        // Search for monuments within 1000m via our backend proxy
        const url = `/api/historical-monuments?lat=${lat}&lon=${lon}&distance=1000`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch historical monuments');
        
        const data = await response.json();
        setMonuments(data.records || []);
      } catch (err: any) {
        console.error('Culture API error:', err);
        setError('Could not retrieve historical monuments');
      } finally {
        setLoading(false);
      }
    };

    fetchMonuments();
  }, [lat, lon]);

  if (!lat || !lon) return null;

  return (
    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded uppercase tracking-wider">Patrimoine (Monuments Historiques)</span>
        </div>
        {loading && <IconLoader2 size={14} className="animate-spin text-amber-500" />}
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <IconAlertCircle size={14} />
          <span>{error}</span>
        </div>
      ) : monuments.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[10px] text-zinc-500 mb-2">Monuments protégés à proximité (rayon 1km) :</p>
          {monuments.map((monument) => (
            <div key={monument.recordid} className="p-2 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="flex gap-2">
                  <IconBuildingCommunity size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="overflow-hidden">
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-white leading-tight truncate" title={monument.fields.tico}>
                      {monument.fields.tico}
                    </h4>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                      <span className="text-[9px] px-1 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded font-bold border border-amber-100 dark:border-amber-800">
                        {monument.fields.stat}
                      </span>
                      <span className="text-[9px] text-zinc-400 flex items-center gap-0.5">
                        <IconMapPin size={10} />
                        {monument.fields.comm} ({monument.fields.dpt})
                        {monument.fields.dist && ` • ${Math.round(parseFloat(monument.fields.dist))}m`}
                      </span>
                    </div>
                  </div>
                </div>
                <a 
                  href={`https://www.pop.culture.gouv.fr/notice/merimee/${monument.fields.ref_merimee || monument.recordid.split('-').pop()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-zinc-400 hover:text-amber-500 transition-colors shrink-0"
                  title="Voir sur POP (Plateforme Ouverte du Patrimoine)"
                >
                  <IconExternalLink size={14} />
                </a>
              </div>
              
              <div className="mt-2 space-y-1">
                {monument.fields.dpro && (
                  <p className="text-[9px] text-zinc-500">
                    <span className="font-bold">Protection :</span> {monument.fields.dpro}
                  </p>
                )}
                {monument.fields.autr && monument.fields.autr.length > 0 && (
                  <p className="text-[9px] text-zinc-500">
                    <span className="font-bold">Auteur :</span> {Array.isArray(monument.fields.autr) ? monument.fields.autr.join(', ') : monument.fields.autr}
                  </p>
                )}
                {monument.fields.prec_lib && (
                  <p className="text-[9px] text-zinc-400 italic line-clamp-2 mt-1 border-t border-zinc-50 dark:border-zinc-800 pt-1">
                    {monument.fields.prec_lib}
                  </p>
                )}
              </div>
            </div>
          ))}
          <a 
            href={`https://atlas.patrimoines.culture.gouv.fr/`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors mt-2"
          >
            <IconHistory size={14} />
            Atlas des Patrimoines
          </a>
        </div>
      ) : !loading && (
        <p className="text-xs text-zinc-400 italic">Aucun monument historique protégé trouvé à proximité immédiate.</p>
      )}
    </div>
  );
}
