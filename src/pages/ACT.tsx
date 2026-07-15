import * as React from 'react';
import { useState, useEffect } from 'react';
import { IconPlus, IconTrash, IconCalculator, IconCheck, IconAlertTriangle, IconDeviceFloppy, IconFileExport, IconSettings } from '@tabler/icons-react';
import { cn, formatCurrency } from '../lib/utils';
import { db } from '../db';
import { apiFetch } from '../lib/api';
import { saveAs } from 'file-saver';
import { loadImageAsDataUrl } from '../lib/imageUtils';

interface Company {
  id: string;
  name: string;
  lot: string;
  comment: string;
  amounts: Record<string, number>; // lotId -> amount
  scores: {
    methodology: number;
    planning: number;
    resources: number;
    qse: number;
    environment: number;
  };
}

interface ACTData {
  projectId: string;
  companies: Company[];
  lots: { id: string, name: string }[];
  scoringCriteria: string[];
  weights: Record<string, number>;
}

const defaultData = (projectId: string): ACTData => ({
  projectId,
  companies: [],
  lots: [
    { id: 'lot1', name: 'Gros Œuvre' },
    { id: 'lot2', name: 'Menuiserie' },
  ],
  scoringCriteria: ['methodology', 'planning', 'resources', 'qse', 'environment'],
  weights: { methodology: 0.2, planning: 0.2, resources: 0.2, qse: 0.2, environment: 0.2 }
});

export default function ACT({ projectId }: { projectId: string }) {
  const [activeTab, setActiveTab] = useState<'saisie' | 'comparatif' | 'synthese' | 'configuration'>('saisie');
  const [data, setData] = useState<ACTData>(defaultData(projectId));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      // 1. Load from Dexie (instant)
      const local = await db.actData.get(projectId);
      if (local) setData(local);
      // 2. Sync with API
      if (navigator.onLine) {
        try {
          const remote = await apiFetch<any>(`/api/projects/${projectId}/act`);
          if (remote) {
            const mapped: ACTData = {
              projectId,
              companies: remote.companies || [],
              lots: remote.lots || [],
              scoringCriteria: remote.scoring_criteria || [],
              weights: remote.weights || {},
            };
            setData(mapped);
            await db.actData.put(mapped);
          }
        } catch (err) {
          console.error('ACT sync failed, using local data', err);
        }
      }
    };
    load();
  }, [projectId]);

  const saveData = async (newData: ACTData) => {
    setIsSaving(true);
    try {
      // 1. Save locally first
      await db.actData.put(newData);
      // 2. Sync to API if online
      if (navigator.onLine) {
        await apiFetch(`/api/projects/${projectId}/act`, {
          method: 'PUT',
          body: JSON.stringify({
            companies: newData.companies,
            lots: newData.lots,
            scoring_criteria: newData.scoringCriteria,
            weights: newData.weights,
          }),
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const addCompany = () => {
    const newCompany = {
      id: Date.now().toString(),
      name: '',
      lot: '',
      comment: '',
      amounts: {},
      scores: { methodology: 0, planning: 0, resources: 0, qse: 0, environment: 0 }
    };
    const newData = { ...data, companies: [...data.companies, newCompany] };
    setData(newData);
    saveData(newData);
  };

  const updateCompany = (id: string, field: string, value: any) => {
    const newData = { ...data, companies: data.companies.map(c => c.id === id ? { ...c, [field]: value } : c) };
    setData(newData);
    saveData(newData);
  };

  const updateAmount = (companyId: string, lotId: string, amount: number) => {
    const newData = { ...data, companies: data.companies.map(c => c.id === companyId ? { ...c, amounts: { ...c.amounts, [lotId]: amount } } : c) };
    setData(newData);
    saveData(newData);
  };

  const calculateTotal = (company: Company) => {
    return Object.values(company.amounts).reduce((acc, val) => acc + (val || 0), 0);
  };

  const calculateTechnicalScore = (company: Company) => {
    return Object.entries(company.scores).reduce((acc, [key, val]) => acc + (val * (data.weights[key] || 0)), 0);
  };

  const exportToCSV = () => {
    const headers = ['Entreprise', 'Total HT', 'Score Technique'];
    const rows = data.companies.map(c => [c.name, calculateTotal(c), calculateTechnicalScore(c).toFixed(2)]);
    const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'analyse_act.csv');
  };

  const exportToPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    let textY = 18;

    try {
      const s = await fetch('/api/settings').then(r => r.ok ? r.json() : null);
      if (s?.logoUrl) {
        try {
          const dataUrl = await loadImageAsDataUrl(s.logoUrl);
          doc.addImage(dataUrl, 'PNG', 10, 6, 28, 10);
        } catch { /* skip */ }
      }
      const label = s?.agencyName ? `${s.agencyName} — ` : '';
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}Analyse des Appels d'Offres (ACT)`, s?.logoUrl ? 42 : 10, textY);
    } catch {
      doc.text('Analyse des Appels d\'Offres (ACT)', 10, textY);
    }

    textY += 10;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    data.companies.forEach((c, i) => {
      doc.text(`${c.name}: Total ${formatCurrency(calculateTotal(c))} - Score ${calculateTechnicalScore(c).toFixed(2)}`, 10, textY + i * 8);
    });
    doc.save('analyse_act.pdf');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Analyse des Appels d'Offres (ACT)</h2>
        <div className="flex gap-2">
          <button onClick={exportToCSV} className="flex items-center gap-2 bg-zinc-600 text-white px-4 py-2 rounded-md hover:bg-zinc-700">
            <IconFileExport size={18} /> CSV
          </button>
          <button onClick={exportToPDF} className="flex items-center gap-2 bg-zinc-600 text-white px-4 py-2 rounded-md hover:bg-zinc-700">
            <IconFileExport size={18} /> PDF
          </button>
          {isSaving && <span className="text-sm text-zinc-500">Saving...</span>}
        </div>
      </div>
      
      <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
        {(['saisie', 'comparatif', 'synthese', 'configuration'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 font-medium capitalize transition-colors",
              activeTab === tab ? "border-b-2 border-blue-600 text-blue-600" : "text-zinc-500 hover:text-zinc-900"
            )}
          >
            {tab === 'saisie' ? 'Saisie DPGF & Mémoire' : tab === 'comparatif' ? 'Tableau Comparatif' : tab === 'synthese' ? 'Synthèse & Classement' : 'Configuration'}
          </button>
        ))}
      </div>

      {activeTab === 'saisie' && (
        <div className="space-y-6">
          <button onClick={addCompany} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
            <IconPlus size={18} /> Ajouter une entreprise
          </button>
          {data.companies.map(company => (
            <div key={company.id} className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <input placeholder="Nom entreprise" className="p-2 border rounded" value={company.name} onChange={e => updateCompany(company.id, 'name', e.target.value)} />
                <input placeholder="Lot" className="p-2 border rounded" value={company.lot} onChange={e => updateCompany(company.id, 'lot', e.target.value)} />
                <input placeholder="Commentaire" className="p-2 border rounded" value={company.comment} onChange={e => updateCompany(company.id, 'comment', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {data.lots.map(lot => (
                  <div key={lot.id}>
                    <label className="text-sm">{lot.name} (HT)</label>
                    <input type="number" className="w-full p-2 border rounded" value={company.amounts[lot.id] || 0} onChange={e => updateAmount(company.id, lot.id, Number(e.target.value))} />
                  </div>
                ))}
              </div>
              <div className="font-bold">Total: {formatCurrency(calculateTotal(company))}</div>
              <div className="grid grid-cols-5 gap-2">
                {data.scoringCriteria.map(criterion => (
                  <div key={criterion}>
                    <label className="text-xs capitalize">{criterion}</label>
                    <input type="number" className="w-full p-2 border rounded" value={company.scores[criterion as keyof Company['scores']]} onChange={e => updateCompany(company.id, 'scores', { ...company.scores, [criterion]: Number(e.target.value) })} />
                  </div>
                ))}
              </div>
              <div className="font-bold">Score Technique: {calculateTechnicalScore(company).toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'comparatif' && (
        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Lot</th>
                {data.companies.map(c => <th key={c.id}>{c.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.lots.map(lot => (
                <tr key={lot.id}>
                  <td>{lot.name}</td>
                  {data.companies.map(c => {
                    const minAmount = Math.min(...data.companies.map(comp => comp.amounts[lot.id] || Infinity));
                    const isMin = (c.amounts[lot.id] || 0) === minAmount && minAmount !== Infinity;
                    const diff = minAmount !== Infinity ? (((c.amounts[lot.id] || 0) - minAmount) / minAmount * 100).toFixed(1) : '0';
                    return (
                      <td key={c.id} className={cn("p-2", isMin && "bg-green-100")}>
                        {formatCurrency(c.amounts[lot.id] || 0)} {isMin ? '' : `(+${diff}%)`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'synthese' && (
        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm space-y-4">
          <h3 className="text-lg font-bold">Classement</h3>
          {data.companies.sort((a, b) => (calculateTotal(a) * 0.6 + (10 - calculateTechnicalScore(a)) * 4) - (calculateTotal(b) * 0.6 + (10 - calculateTechnicalScore(b)) * 4)).map((c, i) => (
            <div key={c.id} className="flex justify-between p-2 border-b">
              <span>{i + 1}. {c.name}</span>
              <span>Score: {(calculateTotal(c) * 0.6 + (10 - calculateTechnicalScore(c)) * 4).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'configuration' && (
        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm space-y-4">
          <h3 className="text-lg font-bold">Configuration des poids</h3>
          {data.scoringCriteria.map(criterion => (
            <div key={criterion} className="flex items-center gap-4">
              <label className="w-32 capitalize">{criterion}</label>
              <input 
                type="number" 
                step="0.01"
                className="p-2 border rounded" 
                value={data.weights[criterion] || 0} 
                onChange={e => {
                  const newData = { ...data, weights: { ...data.weights, [criterion]: Number(e.target.value) } };
                  setData(newData);
                  saveData(newData);
                }} 
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
