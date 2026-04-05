import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { IconPlus, IconFile, IconCheck, IconTrash } from '@tabler/icons-react';
import { DPGFItem, Situation, DetailSituation } from '../types';

export default function Situations({ projectId: propProjectId }: { projectId?: string }) {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const projectId = propProjectId || routeProjectId;
  const [dpgfItems, setDpgfItems] = useState<DPGFItem[]>([]);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [selectedSituation, setSelectedSituation] = useState<Situation | null>(null);
  const [details, setDetails] = useState<DetailSituation[]>([]);

  useEffect(() => {
    if (projectId) {
      fetch(`/api/dpgf/${projectId}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch dpgf items');
          return res.json();
        })
        .then(data => {
          if (Array.isArray(data)) {
            setDpgfItems(data);
          } else {
            console.error('Expected array for dpgf items, received:', data);
            setDpgfItems([]);
          }
        })
        .catch(err => {
          console.error(err);
          setDpgfItems([]);
        });
      fetch(`/api/situations/${projectId}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch situations');
          return res.json();
        })
        .then(data => {
          if (Array.isArray(data)) {
            setSituations(data);
          } else {
            console.error('Expected array for situations, received:', data);
            setSituations([]);
          }
        })
        .catch(err => {
          console.error(err);
          setSituations([]);
        });
    }
  }, [projectId]);

  useEffect(() => {
    if (selectedSituation) {
      fetch(`/api/situations/${selectedSituation.id}/details`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch situation details');
          return res.json();
        })
        .then(data => {
          if (Array.isArray(data)) {
            setDetails(data);
          } else {
            console.error('Expected array for details, received:', data);
            setDetails([]);
          }
        })
        .catch(err => {
          console.error(err);
          setDetails([]);
        });
    }
  }, [selectedSituation]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Situations de Travaux</h1>
      
      <div className="flex gap-4">
        <div className="w-1/3 bg-white p-4 rounded-xl shadow">
          <h2 className="font-bold mb-4">Situations</h2>
          {situations.map(s => (
            <button key={s.id} onClick={() => setSelectedSituation(s)} className="block w-full text-left p-2 hover:bg-zinc-100 rounded">
              Situation n°{s.numero_situation} - {new Date(s.date_situation).toLocaleDateString()}
            </button>
          ))}
        </div>
        
        <div className="w-2/3 bg-white p-4 rounded-xl shadow">
          {selectedSituation ? (
            <>
              <h2 className="font-bold mb-4">Détails Situation n°{selectedSituation.numero_situation}</h2>
              <table className="w-full">
                <thead>
                  <tr className="text-left">
                    <th>Poste</th>
                    <th>Avancement</th>
                  </tr>
                </thead>
                <tbody>
                  {dpgfItems.map(item => {
                    const detail = details.find(d => d.dpgf_item_id === item.id);
                    return (
                      <tr key={item.id}>
                        <td>{item.designation}</td>
                        <td>{detail ? (detail.pourcentage_avancement * 100) + '%' : '0%'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <p>Sélectionnez une situation</p>
          )}
        </div>
      </div>
    </div>
  );
}
