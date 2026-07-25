import * as React from 'react';
import { useState, useMemo } from 'react';
import Select, { StylesConfig } from 'react-select';
import chroma from 'chroma-js';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconClock,
  IconCheck,
  IconPlus,
  IconFileText,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
  IconX,
  IconMapPin,
} from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { CardHeader } from '../ui/Card';
import { StatTile } from '../ui/StatTile';
import { PlanAnnotator } from '../PlanAnnotator';
import type { Reserve, GpaReserve, Plan } from '../../types';

interface CategoryOption {
  value: string;
  label: string;
  color: string;
}

const colourStyles: StylesConfig<CategoryOption, true> = {
  control: (styles) => ({ ...styles, backgroundColor: 'white' }),
  option: (styles, { data, isDisabled, isFocused, isSelected }) => {
    const color = chroma(data.color);
    return {
      ...styles,
      backgroundColor: isDisabled
        ? undefined
        : isSelected
        ? data.color
        : isFocused
        ? color.alpha(0.1).css()
        : undefined,
      color: isDisabled
        ? '#ccc'
        : isSelected
        ? chroma.contrast(color, 'white') > 2
          ? 'white'
          : 'black'
        : data.color,
      cursor: isDisabled ? 'not-allowed' : 'default',
      ':active': {
        ...styles[':active'],
        backgroundColor: !isDisabled
          ? isSelected
            ? data.color
            : color.alpha(0.3).css()
          : undefined,
      },
    };
  },
  multiValue: (styles, { data }) => {
    const color = chroma(data.color);
    return { ...styles, backgroundColor: color.alpha(0.1).css() };
  },
  multiValueLabel: (styles, { data }) => ({ ...styles, color: data.color }),
  multiValueRemove: (styles, { data }) => ({
    ...styles,
    color: data.color,
    ':hover': { backgroundColor: data.color, color: 'white' },
  }),
};

type ReserveLike = Reserve | GpaReserve;

interface ReserveTrackerProps {
  projectId: string;
  apiBase: '/api/reserves' | '/api/gpa-reserves';
  title: string;
  reserves: ReserveLike[];
  setReserves: React.Dispatch<React.SetStateAction<any[]>>;
  plans: Plan[];
  lotsList?: { id: string; lot_title: string; contact_id?: string; contact_name?: string }[];
}

/**
 * Reserve tracking card (create / list / status workflow) shared by the OPR
 * "Réserves" section and the GPA "Réserves GPA" section — same mechanism,
 * different backing table (`apiBase`), same shape of data.
 */
export function ReserveTracker({ projectId, apiBase, title, reserves, setReserves, plans, lotsList }: ReserveTrackerProps) {
  const [isAddingReserve, setIsAddingReserve] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [annotationCoords, setAnnotationCoords] = useState<{ x: number; y: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [editReserveData, setEditReserveData] = useState<ReserveLike | null>(null);
  const [newReserve, setNewReserve] = useState({
    title: '',
    batiment: '',
    local: '',
    status: 'A faire',
    lots: [] as any[],
    entreprises: [] as any[],
    created_at: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const reserveStats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      ouvertes: reserves.filter(r => r.status === 'A faire' || r.status === 'En cours').length,
      retard: reserves.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis' && new Date(r.due_date) < today).length,
      urgentes: reserves.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis' && new Date(r.due_date) >= today && new Date(r.due_date) <= in7).length,
      levees: reserves.filter(r => r.status === 'Levée' || r.status === 'Quitus Transmis').length,
    };
  }, [reserves]);

  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null;

  const planMarkers = useMemo(() => (
    reserves
      .filter(r => r.plan_id === selectedPlanId && r.x != null && r.y != null)
      .map(r => ({ id: r.id, x: r.x as number, y: r.y as number, number: r.number, title: r.title }))
  ), [reserves, selectedPlanId]);

  const handleSelectMarker = (markerId: string) => {
    const res = reserves.find(r => r.id === markerId);
    if (!res) return;
    const lots = JSON.parse(res.lots || '[]');
    const entreprises = JSON.parse(res.entreprises || '[]');
    const groupKey = lots.length > 0 ? `${lots.join(', ')} / ${entreprises.join(', ')}` : 'Sans Lot / Entreprise';
    setExpandedGroups(prev => ({ ...prev, [groupKey]: true }));
    setEditingReserveId(res.id);
    setEditReserveData({ ...res });
  };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label={`${title} ouvertes`} color="blue" icon={IconAlertTriangle} value={reserveStats.ouvertes} sub="A faire + En cours" />
        <StatTile label="En retard" color="red" icon={IconAlertCircle} value={reserveStats.retard} sub="Échéance dépassée" />
        <StatTile label="Urgentes" color="orange" icon={IconClock} value={reserveStats.urgentes} sub="Dans les 7 jours" />
        <StatTile label="Levées" color="green" icon={IconCheck} value={reserveStats.levees} sub="Levée + Quitus" />
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <CardHeader
          icon={IconClipboardCheck}
          title={title}
          action={
            <div className="flex items-center gap-2">
              {plans.length > 0 && (
                <select
                  className="bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none"
                  value={selectedPlanId || ''}
                  onChange={e => { setSelectedPlanId(e.target.value || null); setAnnotationCoords(null); }}
                >
                  <option value="">Sélectionner un plan</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => { setIsAddingReserve(!isAddingReserve); setAnnotationCoords(null); }}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all"
              >
                <IconPlus size={14} />
                {isAddingReserve ? 'Annuler' : 'Créer une réserve'}
              </button>
            </div>
          }
        />

        {selectedPlan && (
          <div className="p-4 border-b border-[var(--tblr-border)] space-y-2">
            {isAddingReserve && (
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--tblr-muted)]">
                <IconMapPin size={14} className={annotationCoords ? 'text-green-600' : 'text-blue-600'} />
                {annotationCoords
                  ? 'Position sélectionnée sur le plan — cliquez à nouveau pour la déplacer.'
                  : 'Cliquez sur le plan ci-dessous pour positionner la réserve (optionnel).'}
              </div>
            )}
            <div className="h-[500px]">
              <PlanAnnotator
                fileUrl={selectedPlan.file_url}
                markers={planMarkers}
                pendingMarker={isAddingReserve ? annotationCoords : null}
                onAddMarker={(x, y) => setAnnotationCoords({ x, y })}
                onSelectMarker={handleSelectMarker}
                isAddingMode={isAddingReserve}
              />
            </div>
          </div>
        )}

        {isAddingReserve && (
          <div className="p-6 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Intitulé</label>
                <input
                  type="text"
                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newReserve.title}
                  onChange={e => setNewReserve(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="ex: Peinture à reprendre"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Bâtiment</label>
                <input
                  type="text"
                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newReserve.batiment}
                  onChange={e => setNewReserve(prev => ({ ...prev, batiment: e.target.value }))}
                  placeholder="ex: Bâtiment A"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Local</label>
                <input
                  type="text"
                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newReserve.local}
                  onChange={e => setNewReserve(prev => ({ ...prev, local: e.target.value }))}
                  placeholder="ex: Salon"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Statut</label>
                <select
                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newReserve.status}
                  onChange={e => setNewReserve(prev => ({ ...prev, status: e.target.value as any }))}
                >
                  <option value="A faire">A faire</option>
                  <option value="En cours">En cours</option>
                  <option value="Levée">Levée</option>
                  <option value="Refusée par l'entreprise">Refusée par l'entreprise</option>
                  <option value="Quitus Transmis">Quitus Transmis</option>
                  <option value="Levée refusée par le MOE">Levée refusée par le MOE</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Lots</label>
                <Select
                  isMulti
                  options={lotsList?.map(l => ({ value: l.id, label: l.lot_title, color: '#3b82f6' })) || []}
                  styles={colourStyles as any}
                  className="text-sm"
                  onChange={(vals: any) => setNewReserve(prev => ({ ...prev, lots: vals }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Entreprises</label>
                <Select
                  isMulti
                  options={lotsList?.filter(l => l.contact_name).map(l => ({ value: l.contact_id || l.contact_name, label: l.contact_name, color: '#10b981' })) || []}
                  styles={colourStyles as any}
                  className="text-sm"
                  onChange={(vals: any) => setNewReserve(prev => ({ ...prev, entreprises: vals }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date de création</label>
                <input
                  type="date"
                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newReserve.created_at}
                  onChange={e => {
                    const newDate = e.target.value;
                    const dueDate = new Date(new Date(newDate).getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    setNewReserve(prev => ({ ...prev, created_at: newDate, due_date: dueDate }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--tblr-muted)] uppercase">Date d'échéance</label>
                <input
                  type="date"
                  className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={newReserve.due_date}
                  onChange={e => setNewReserve(prev => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setIsAddingReserve(false); setAnnotationCoords(null); }}
                className="px-4 py-2 text-sm font-bold text-[var(--tblr-muted)] hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={async () => {
                  if (!newReserve.title) return;
                  try {
                    const res = await fetch(apiBase, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: window.crypto.randomUUID(),
                        project_id: projectId,
                        title: newReserve.title,
                        batiment: newReserve.batiment,
                        local: newReserve.local,
                        status: newReserve.status,
                        lots: JSON.stringify(newReserve.lots.map(l => l.label)),
                        entreprises: JSON.stringify(newReserve.entreprises.map(e => e.label)),
                        created_at: newReserve.created_at,
                        due_date: newReserve.due_date,
                        plan_id: selectedPlanId,
                        x: annotationCoords?.x,
                        y: annotationCoords?.y,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setReserves(prev => [...prev, data]);
                      setIsAddingReserve(false);
                      setAnnotationCoords(null);
                      setNewReserve({
                        title: '',
                        batiment: '',
                        local: '',
                        status: 'A faire',
                        lots: [],
                        entreprises: [],
                        created_at: new Date().toISOString().split('T')[0],
                        due_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                      });
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all"
              >
                Ajouter
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left w-12">N°</th>
                <th className="px-4 py-3 text-left">Bâtiment / Local</th>
                <th className="px-4 py-3 text-left">Intitulé</th>
                <th className="px-4 py-3 text-left">Statut</th>
                <th className="px-4 py-3 text-left">Créé le</th>
                <th className="px-4 py-3 text-left">Echéance / Retard</th>
                <th className="px-4 py-3 text-right w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {(Object.entries(reserves.reduce((acc, res) => {
                const lots = JSON.parse(res.lots || '[]');
                const entreprises = JSON.parse(res.entreprises || '[]');
                const groupKey = lots.length > 0 ? `${lots.join(', ')} / ${entreprises.join(', ')}` : 'Sans Lot / Entreprise';
                if (!acc[groupKey]) acc[groupKey] = [];
                acc[groupKey].push(res);
                return acc;
              }, {} as Record<string, ReserveLike[]>)) as [string, ReserveLike[]][]).map(([groupKey, groupReserves]) => (
                <React.Fragment key={groupKey}>
                  <tr
                    className="bg-zinc-50/50 dark:bg-zinc-800/20 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors"
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                  >
                    <td colSpan={7} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {expandedGroups[groupKey] ? <IconChevronDown size={14} className="text-[var(--tblr-muted)]" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)]" />}
                        <span className="font-bold text-[var(--tblr-text)] uppercase tracking-wider text-[11px]">{groupKey}</span>
                        <span className="text-[10px] text-[var(--tblr-muted)] font-normal">({groupReserves.length} réserves)</span>
                      </div>
                    </td>
                  </tr>
                  {expandedGroups[groupKey] && groupReserves.map((res) => {
                    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
                    const dueD = new Date(res.due_date); dueD.setHours(0, 0, 0, 0);
                    const isOverdue = dueD < todayD && res.status !== 'Levée' && res.status !== 'Quitus Transmis';
                    const retardJours = isOverdue ? Math.floor((todayD.getTime() - dueD.getTime()) / 86400000) : 0;
                    return (
                      <tr key={res.id} className={cn("transition-colors group", isOverdue ? "bg-red-50/30 dark:bg-red-950/10 hover:bg-red-50/50" : "hover:bg-[var(--tblr-surface-2)]")}>
                        <td className="px-4 py-4 font-mono text-[10px] text-[var(--tblr-muted)]">
                          #{res.number || '-'}
                        </td>
                        <td className="px-4 py-4">
                          {editingReserveId === res.id ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs w-20"
                                value={editReserveData?.batiment}
                                onChange={e => setEditReserveData(prev => prev ? ({ ...prev, batiment: e.target.value }) : null)}
                              />
                              <input
                                type="text"
                                className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs w-20"
                                value={editReserveData?.local}
                                onChange={e => setEditReserveData(prev => prev ? ({ ...prev, local: e.target.value }) : null)}
                              />
                            </div>
                          ) : (
                            <span className="text-zinc-600 dark:text-zinc-300">{res.batiment} {res.local && `/ ${res.local}`}</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {editingReserveId === res.id ? (
                            <input
                              type="text"
                              className="w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs"
                              value={editReserveData?.title}
                              onChange={e => setEditReserveData(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
                            />
                          ) : (
                            <div className="font-medium text-[var(--tblr-text)]">{res.title}</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <select
                            className={cn(
                              "border-none rounded-full text-[10px] font-bold uppercase tracking-wider px-2 py-1 outline-none cursor-pointer",
                              res.status === 'Levée' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                              res.status === 'Quitus Transmis' ? "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" :
                              res.status === 'En cours' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                              res.status === 'Refusée par l\'entreprise' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                              res.status === 'Levée refusée par le MOE' ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" :
                              "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            )}
                            value={res.status}
                            onChange={async (e) => {
                              const newStatus = e.target.value as ReserveLike['status'];
                              try {
                                const updated = { ...res, status: newStatus };
                                const response = await fetch(`${apiBase}/${res.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(updated),
                                });
                                if (response.ok) {
                                  setReserves(prev => prev.map(r => r.id === res.id ? updated : r));
                                }
                              } catch (err) { console.error(err); }
                            }}
                          >
                            <option value="A faire">A faire</option>
                            <option value="En cours">En cours</option>
                            <option value="Levée">Levée</option>
                            <option value="Refusée par l'entreprise">Refusée par l'entreprise</option>
                            <option value="Quitus Transmis">Quitus Transmis</option>
                            <option value="Levée refusée par le MOE">Levée refusée par le MOE</option>
                          </select>
                        </td>
                        <td className="px-4 py-4 text-[10px] text-[var(--tblr-muted)]">
                          {new Date(res.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-4 py-4">
                          {editingReserveId === res.id ? (
                            <input
                              type="date"
                              className="bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded p-1 text-xs"
                              value={editReserveData?.due_date}
                              onChange={e => setEditReserveData(prev => prev ? ({ ...prev, due_date: e.target.value }) : null)}
                            />
                          ) : (
                            <div className="space-y-0.5">
                              <div className={cn("text-xs font-medium", isOverdue ? "text-red-500" : "text-zinc-600 dark:text-zinc-300")}>
                                {new Date(res.due_date).toLocaleDateString('fr-FR')}
                              </div>
                              {isOverdue && (
                                <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[9px] font-bold">
                                  +{retardJours}j
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {editingReserveId === res.id ? (
                              <>
                                <button
                                  onClick={async () => {
                                    if (!editReserveData) return;
                                    try {
                                      const response = await fetch(`${apiBase}/${editReserveData.id}`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(editReserveData),
                                      });
                                      if (response.ok) {
                                        setReserves(prev => prev.map(r => r.id === editReserveData.id ? editReserveData : r));
                                        setEditingReserveId(null);
                                        setEditReserveData(null);
                                      }
                                    } catch (err) { console.error(err); }
                                  }}
                                  className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                >
                                  <IconCheck size={14} />
                                </button>
                                <button
                                  onClick={() => { setEditingReserveId(null); setEditReserveData(null); }}
                                  className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                >
                                  <IconX size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setEditingReserveId(res.id); setEditReserveData({ ...res }); }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                  title="Modifier"
                                >
                                  <IconFileText size={14} />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!confirm('Supprimer cette réserve ?')) return;
                                    try {
                                      const response = await fetch(`${apiBase}/${res.id}`, { method: 'DELETE' });
                                      if (response.ok) setReserves(prev => prev.filter(r => r.id !== res.id));
                                    } catch (err) { console.error(err); }
                                  }}
                                  className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                  title="Supprimer"
                                >
                                  <IconTrash size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
              {reserves.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucune réserve.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default ReserveTracker;
