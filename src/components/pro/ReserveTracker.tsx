import * as React from 'react';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconClipboardCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconClock,
  IconCheck,
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
  IconMapPin,
  IconCamera,
  IconFileTypePdf,
  IconSearch,
  IconLoader2,
} from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { CardHeader } from '../ui/Card';
import { StatTile } from '../ui/StatTile';
import { PlanAnnotator } from '../PlanAnnotator';
import { SignedImage } from '../SignedImage';
import type { Plan } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import type { ReservesExportProject } from '../../lib/reservesExport';
import { ReserveDetail, type LotOption } from './ReserveDetail';
import { type ReserveLike, StatusSelect, parseJsonList, reserveOverdueDays, isReserveClosed } from './reserveShared';

interface ReserveTrackerProps {
  projectId: string;
  apiBase: '/api/reserves' | '/api/gpa-reserves';
  title: string;
  reserves: ReserveLike[];
  setReserves: React.Dispatch<React.SetStateAction<any[]>>;
  plans: Plan[];
  lotsList?: LotOption[];
  /** Pour l'export PDF : l'affaire et la charte du cabinet. */
  project?: ReservesExportProject | null;
  settings?: AgencySettings | null;
}

type Filter = 'ouvertes' | 'retard' | 'levees' | 'toutes';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ouvertes', label: 'Ouvertes' },
  { id: 'retard', label: 'En retard' },
  { id: 'levees', label: 'Levées' },
  { id: 'toutes', label: 'Toutes' },
];

/**
 * Suivi des réserves — la même carte pour les réserves d'OPR et les réserves
 * GPA (`apiBase`), sur le modèle d'une application de chantier : une liste de
 * cartes sur mobile, un tableau groupé par lot au bureau, et dans les deux
 * cas un appui sur la réserve ouvre sa fiche (photos, extrait de plan,
 * commentaire — voir ReserveDetail). La création passe par la même fiche,
 * avec la photo prise sur place. L'export PDF (lib/reservesExport.ts) sort
 * la liste filtrée à l'écran.
 */
export function ReserveTracker({ projectId, apiBase, title, reserves, setReserves, plans, lotsList, project, settings }: ReserveTrackerProps) {
  const { t } = useTranslation();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [annotationCoords, setAnnotationCoords] = useState<{ x: number; y: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [openReserveId, setOpenReserveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('toutes');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  const reserveStats = useMemo(() => ({
    ouvertes: reserves.filter(r => r.status === 'A faire' || r.status === 'En cours').length,
    retard: reserves.filter(r => reserveOverdueDays(r) > 0).length,
    urgentes: reserves.filter(r => {
      if (isReserveClosed(r) || !r.due_date) return false;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const in7 = new Date(today.getTime() + 7 * 86400000);
      const due = new Date(r.due_date);
      return due >= today && due <= in7;
    }).length,
    levees: reserves.filter(isReserveClosed).length,
  }), [reserves]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reserves.filter(r => {
      if (filter === 'ouvertes' && isReserveClosed(r)) return false;
      if (filter === 'retard' && reserveOverdueDays(r) === 0) return false;
      if (filter === 'levees' && !isReserveClosed(r)) return false;
      if (!q) return true;
      const hay = [r.title, r.batiment, r.local, r.description, ...parseJsonList(r.lots), ...parseJsonList(r.entreprises), String(r.number ?? '')]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [reserves, filter, search]);

  const selectedPlan = plans.find(p => p.id === selectedPlanId) || null;
  const openReserve = reserves.find(r => r.id === openReserveId) || null;

  const planMarkers = useMemo(() => (
    reserves
      .filter(r => r.plan_id === selectedPlanId && r.x != null && r.y != null)
      .map(r => ({ id: r.id, x: r.x as number, y: r.y as number, number: r.number, title: r.title }))
  ), [reserves, selectedPlanId]);

  const groupKeyOf = (r: ReserveLike) => {
    const lots = parseJsonList(r.lots);
    const entreprises = parseJsonList(r.entreprises);
    return lots.length > 0 ? `${lots.join(', ')} / ${entreprises.join(', ')}` : 'Sans Lot / Entreprise';
  };

  const groups = useMemo(() => {
    const acc: Record<string, ReserveLike[]> = {};
    for (const r of visible) (acc[groupKeyOf(r)] ||= []).push(r);
    for (const k of Object.keys(acc)) acc[k].sort((a, b) => (a.number || 0) - (b.number || 0));
    return Object.entries(acc);
  }, [visible]);

  const mobileList = useMemo(() => [...visible].sort((a, b) => (b.number || 0) - (a.number || 0)), [visible]);

  const changeStatus = async (res: ReserveLike, status: ReserveLike['status']) => {
    const updated = { ...res, status };
    try {
      const response = await fetch(`${apiBase}/${res.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (response.ok) setReserves(prev => prev.map(r => r.id === res.id ? updated : r));
    } catch (err) { console.error(err); }
  };

  const deleteReserve = async (res: ReserveLike) => {
    if (!confirm(t('reserve_tracker_confirm_delete', { number: res.number ?? '' }))) return;
    try {
      const response = await fetch(`${apiBase}/${res.id}`, { method: 'DELETE' });
      if (response.ok) setReserves(prev => prev.filter(r => r.id !== res.id));
    } catch (err) { console.error(err); }
  };

  const handleExport = async () => {
    if (!project || !settings) { alert(t('reserve_tracker_settings_not_loaded')); return; }
    if (visible.length === 0) { alert(t('reserve_tracker_no_reserves_to_export')); return; }
    setExporting('Préparation…');
    try {
      const { exportReservesToPDF } = await import('../../lib/reservesExport');
      await exportReservesToPDF(visible, plans, project, settings, { title, onProgress: setExporting });
    } catch (err) {
      console.error('[ReserveTracker] export', err);
      alert(t('reserve_tracker_export_failed'));
    } finally {
      setExporting(null);
    }
  };

  const openForCreation = () => setCreating(true);

  const renderThumb = (r: ReserveLike, className: string) => {
    const first = r.photos?.[0];
    if (!first) {
      return (
        <div className={cn(className, 'flex items-center justify-center rounded-lg bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]')}>
          <IconCamera size={18} />
        </div>
      );
    }
    return (
      <div className={cn(className, 'relative')}>
        <SignedImage src={first.file_url} alt="" className="w-full h-full object-cover rounded-lg" />
        {(r.photos?.length || 0) > 1 && (
          <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/60 text-white text-[9px] font-bold">{r.photos!.length}</span>
        )}
      </div>
    );
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
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {plans.length > 0 && (
                <select
                  className="bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none max-w-[160px]"
                  value={selectedPlanId || ''}
                  onChange={e => { setSelectedPlanId(e.target.value || null); setAnnotationCoords(null); }}
                >
                  <option value="">Plan</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <button
                onClick={handleExport}
                disabled={!!exporting || reserves.length === 0}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                title="Exporter la liste de réserves en PDF"
              >
                {exporting ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileTypePdf size={14} />}
                <span className="hidden sm:inline">{exporting || 'Exporter PDF'}</span>
              </button>
              <button
                onClick={openForCreation}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all"
              >
                <IconPlus size={14} />
                Créer une réserve
              </button>
            </div>
          }
        />

        {selectedPlan && (
          <div className="p-3 sm:p-4 border-b border-[var(--tblr-border)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--tblr-muted)] flex-wrap">
              <IconMapPin size={14} className={annotationCoords ? 'text-green-600' : 'text-blue-600'} />
              {annotationCoords ? (
                <>
                  <span>Repère posé sur le plan.</span>
                  <button onClick={openForCreation} className="px-2 py-1 rounded bg-blue-600 text-white font-bold">Créer une réserve ici</button>
                  <button onClick={() => setAnnotationCoords(null)} className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 font-bold">Annuler</button>
                </>
              ) : (
                <span>Touchez le plan pour positionner une nouvelle réserve, ou un repère pour ouvrir sa fiche.</span>
              )}
            </div>
            <div className="h-[60vh] sm:h-[500px]">
              <PlanAnnotator
                fileUrl={selectedPlan.file_url}
                markers={planMarkers}
                pendingMarker={annotationCoords}
                onAddMarker={(x, y) => setAnnotationCoords({ x, y })}
                onSelectMarker={id => setOpenReserveId(id)}
                isAddingMode
              />
            </div>
          </div>
        )}

        {/* Filtres et recherche */}
        <div className="px-3 sm:px-4 py-3 border-b border-[var(--tblr-border)] flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold transition-colors',
                  filter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 border-none outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="text-[10px] text-[var(--tblr-muted)] font-medium">{visible.length} / {reserves.length}</span>
        </div>

        {/* Mobile : une carte par réserve */}
        <div className="md:hidden divide-y divide-[var(--tblr-border)]">
          {mobileList.map(res => {
            const retard = reserveOverdueDays(res);
            const entreprises = parseJsonList(res.entreprises);
            const lots = parseJsonList(res.lots);
            return (
              <button
                key={res.id}
                type="button"
                onClick={() => setOpenReserveId(res.id)}
                className={cn('w-full text-left px-3 py-3 flex gap-3 active:bg-[var(--tblr-surface-2)]', retard > 0 && 'bg-red-50/40 dark:bg-red-950/10')}
              >
                {renderThumb(res, 'w-16 h-16 shrink-0')}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-[11px] font-bold text-[var(--tblr-muted)] pt-0.5">#{res.number ?? '-'}</span>
                    <span className="font-semibold text-sm text-[var(--tblr-text)] leading-snug line-clamp-2">{res.title}</span>
                  </div>
                  <div className="text-[11px] text-[var(--tblr-muted)] truncate">
                    {[entreprises.join(', ') || lots.join(', '), [res.batiment, res.local].filter(Boolean).join(' / ')].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-[11px] font-medium', retard > 0 ? 'text-red-600' : 'text-[var(--tblr-muted)]')}>
                      {res.due_date ? new Date(res.due_date).toLocaleDateString('fr-FR') : 'Sans échéance'}
                      {retard > 0 && <span className="ml-1 px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[9px] font-bold">+{retard}j</span>}
                    </span>
                    <StatusSelect value={res.status} onChange={s => changeStatus(res, s)} />
                  </div>
                </div>
              </button>
            );
          })}
          {mobileList.length === 0 && (
            <div className="px-6 py-8 text-center text-[var(--tblr-muted)] italic text-sm">Aucune réserve.</div>
          )}
        </div>

        {/* Bureau : tableau groupé par lot / entreprise */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left w-12">N°</th>
                <th className="px-4 py-3 text-left w-16">Photo</th>
                <th className="px-4 py-3 text-left">Intitulé</th>
                <th className="px-4 py-3 text-left">Bâtiment / Local</th>
                <th className="px-4 py-3 text-left">Statut</th>
                <th className="px-4 py-3 text-left">Créé le</th>
                <th className="px-4 py-3 text-left">Echéance / Retard</th>
                <th className="px-4 py-3 text-right w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {groups.map(([groupKey, groupReserves]) => {
                const expanded = expandedGroups[groupKey] ?? true;
                return (
                  <React.Fragment key={groupKey}>
                    <tr
                      className="bg-zinc-50/50 dark:bg-zinc-800/20 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors"
                      onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: !expanded }))}
                    >
                      <td colSpan={8} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {expanded ? <IconChevronDown size={14} className="text-[var(--tblr-muted)]" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)]" />}
                          <span className="font-bold text-[var(--tblr-text)] uppercase tracking-wider text-[11px]">{groupKey}</span>
                          <span className="text-[10px] text-[var(--tblr-muted)] font-normal">({groupReserves.length} réserve{groupReserves.length > 1 ? 's' : ''})</span>
                        </div>
                      </td>
                    </tr>
                    {expanded && groupReserves.map(res => {
                      const retard = reserveOverdueDays(res);
                      return (
                        <tr
                          key={res.id}
                          onClick={() => setOpenReserveId(res.id)}
                          className={cn('transition-colors group cursor-pointer', retard > 0 ? 'bg-red-50/30 dark:bg-red-950/10 hover:bg-red-50/50' : 'hover:bg-[var(--tblr-surface-2)]')}
                        >
                          <td className="px-4 py-3 font-mono text-[10px] text-[var(--tblr-muted)]">#{res.number || '-'}</td>
                          <td className="px-4 py-2">{renderThumb(res, 'w-12 h-12')}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[var(--tblr-text)]">{res.title}</div>
                            {res.description && <div className="text-[11px] text-[var(--tblr-muted)] line-clamp-1">{res.description}</div>}
                          </td>
                          <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{[res.batiment, res.local].filter(Boolean).join(' / ') || '—'}</td>
                          <td className="px-4 py-3"><StatusSelect value={res.status} onChange={s => changeStatus(res, s)} /></td>
                          <td className="px-4 py-3 text-[10px] text-[var(--tblr-muted)]">{res.created_at ? new Date(res.created_at).toLocaleDateString('fr-FR') : ''}</td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <div className={cn('text-xs font-medium', retard > 0 ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300')}>
                                {res.due_date ? new Date(res.due_date).toLocaleDateString('fr-FR') : '—'}
                              </div>
                              {retard > 0 && (
                                <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[9px] font-bold">+{retard}j</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={e => { e.stopPropagation(); deleteReserve(res); }}
                              className="p-1.5 text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Supprimer"
                            >
                              <IconTrash size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-[var(--tblr-muted)] italic">Aucune réserve.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || openReserve) && (
        <ReserveDetail
          apiBase={apiBase}
          projectId={projectId}
          reserve={creating ? null : openReserve}
          plans={plans}
          lotsList={lotsList}
          pendingPlan={creating ? { planId: selectedPlanId, x: annotationCoords?.x, y: annotationCoords?.y } : null}
          onClose={() => { setCreating(false); setOpenReserveId(null); }}
          onSaved={saved => {
            setReserves(prev => prev.some(r => r.id === saved.id) ? prev.map(r => r.id === saved.id ? saved : r) : [...prev, saved]);
            setAnnotationCoords(null);
          }}
          onDeleted={id => setReserves(prev => prev.filter(r => r.id !== id))}
        />
      )}
    </>
  );
}

export default ReserveTracker;
