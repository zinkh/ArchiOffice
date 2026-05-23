import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconPlus, IconEdit, IconTrash, IconCalculator, IconCheck, IconAlertTriangle, IconDeviceFloppy, IconFileExport, IconSettings } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { db } from '../db';
import { apiFetch } from '../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type StatutObservation = "en_cours" | "leve" | "a_lever" | "info";
type NiveauUrgence = "normal" | "urgent" | "bloquant";

interface Intervenant {
  id: string;
  entreprise: string;
  nom: string;
  role: string;
  present: boolean;
  excused: boolean;
}

interface Observation {
  id: string;
  numero: string;
  lot: string;
  entreprise: string;
  description: string;
  statut: StatutObservation;
  urgence: NiveauUrgence;
  echeance: string;
  responsable: string;
  reporteeDe: string;
  crOrigine: string;
  photos: string[];
  createdAt: string;
}

interface ReunionInfo {
  numero: string;
  projet: string;
  adresse: string;
  date: string;
  heure: string;
  type: string;
  maitriseOuvrage: string;
  maitreOeuvre: string;
  objet: string;
}

interface CompteRendu {
  id: string;
  info: ReunionInfo;
  observations: Observation[];
  intervenants: Intervenant[];
}

export default function DET({ projectId }: { projectId: string }) {
  const [crs, setCrs] = useState<CompteRendu[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedCR, setSelectedCR] = useState<CompteRendu | null>(null);

  useEffect(() => {
    const load = async () => {
      // 1. Load from Dexie (instant offline support)
      const local = await db.detData.where('projectId').equals(projectId).toArray();
      if (local.length > 0) setCrs(local);
      // 2. Sync with API
      if (navigator.onLine) {
        try {
          const remote = await apiFetch<CompteRendu[]>(`/api/projects/${projectId}/det`);
          if (remote && remote.length > 0) {
            // Merge remote into Dexie
            for (const cr of remote) {
              await db.detData.put({ ...cr, projectId });
            }
            setCrs(remote);
          }
        } catch (err) {
          console.error('DET sync failed, using local data', err);
        }
      }
    };
    load();
  }, [projectId]);

  const addCR = async () => {
    const newCR: CompteRendu = {
      id: Date.now().toString(),
      info: { numero: `CR-${crs.length + 1}`, projet: projectId, adresse: '', date: '', heure: '', type: '', maitriseOuvrage: '', maitreOeuvre: '', objet: '' },
      observations: [],
      intervenants: []
    };
    // Save locally first
    await db.detData.put({ ...newCR, projectId });
    const newCrs = [...crs, newCR];
    setCrs(newCrs);
    // Sync to API
    if (navigator.onLine) {
      setIsSaving(true);
      try {
        await apiFetch(`/api/projects/${projectId}/det`, {
          method: 'POST',
          body: JSON.stringify(newCR),
        });
      } catch (err) {
        console.error('Failed to sync new CR:', err);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const saveData = async (newCrs: CompteRendu[]) => {
    setIsSaving(true);
    try {
      for (const cr of newCrs) {
        await db.detData.put({ ...cr, projectId });
        if (navigator.onLine) {
          await apiFetch(`/api/projects/${projectId}/det/${cr.id}`, {
            method: 'PUT',
            body: JSON.stringify(cr),
          });
        }
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Comptes Rendus de Réunions (DET)</h2>
        <button onClick={addCR} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
          <IconPlus size={18} /> Nouveau CR
        </button>
        {isSaving && <span className="text-sm text-zinc-500">Saving...</span>}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {crs.map(cr => (
          <div key={cr.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <h3 className="font-bold text-lg">{cr.info.numero} - {cr.info.objet}</h3>
            <p className="text-sm text-zinc-500">{cr.info.date} - {cr.info.type}</p>
            <button onClick={() => setSelectedCR(cr)} className="mt-4 flex items-center gap-2 text-blue-600 hover:text-blue-800">
              <IconEdit size={16} /> Modifier
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
