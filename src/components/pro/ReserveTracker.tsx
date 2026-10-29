import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  IconMessage,
} from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { CardHeader } from '../ui/Card';
import { StatTile } from '../ui/StatTile';
import { PlanAnnotator } from '../PlanAnnotator';
import {
  queuedJsonRequest, listPendingWrites, getReplayProgress, subscribeReplayProgress,
  OFFLINE_WRITE_SYNCED_EVENT, OFFLINE_QUEUE_CHANGED_EVENT,
} from '../../lib/offlineQueue';
import {
  photoEntityFor, pendingPhotosByReserve, overlayPendingPhotos, previewUrlFor, releasePreviewUrl,
} from '../../lib/reservePhotoQueue';
import {
  RESERVE_PAGE_SIZE, paginateFlat, paginateGroups, nextLimit, nextChunk, rankInFlat, rankInGroups, limitToReveal,
} from '../../lib/reservePagination';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { Plan, ReservePhoto } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import type { ReservesExportProject } from '../../lib/reservesExport';
import { ReserveDetail, type LotOption } from './ReserveDetail';
import { type ReserveLike, StatusSelect, ReservePhotoImage, parseJsonList, reserveOverdueDays, isReserveClosed } from './reserveShared';

interface ReserveTrackerProps {
  projectId: string;
  apiBase: '/api/reserves' | '/api/gpa-reserves';
  title: string;
  /** Intitulé court des tuiles de synthèse quand le titre est long (« GPA »). */
  shortTitle?: string;
  reserves: ReserveLike[];
  setReserves: React.Dispatch<React.SetStateAction<any[]>>;
  plans: Plan[];
  lotsList?: LotOption[];
  /** Pour l'export PDF : l'affaire et la charte du cabinet. */
  project?: ReservesExportProject | null;
  settings?: AgencySettings | null;
  /** Ouvre directement cette réserve à l'arrivée sur l'onglet — lien direct
   *  depuis un agent (?open=reserves:<id> sur /projects/:id, voir
   *  recordLinks.ts côté serveur et ProjectDetail.tsx). */
  initialOpenReserveId?: string | null;
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
export function ReserveTracker({ projectId, apiBase, title, shortTitle, reserves: serverReserves, setReserves, plans, lotsList, project, settings, initialOpenReserveId }: ReserveTrackerProps) {
  const { t } = useTranslation();

  // Photos prises sur l'appareil et pas encore arrivées sur le serveur : elles partent en arrière-plan
  // (voir ReserveDetail) et sont superposées ici à la liste lue, pour rester visibles, avec leur aperçu
  // local, après un rechargement ou la fermeture de la fiche.
  const photoEntity = photoEntityFor(apiBase);
  const [pendingPhotos, setPendingPhotos] = useState<Map<string, ReservePhoto[]>>(() => new Map());
  const refreshPendingPhotos = useCallback(async () => {
    const writes = await listPendingWrites(photoEntity);
    const blobs = new Map(writes.map(w => [w.id, w.blob]));
    setPendingPhotos(pendingPhotosByReserve(writes, photoEntity, id => previewUrlFor(id, blobs.get(id))));
  }, [photoEntity]);
  const reserves = useMemo(() => overlayPendingPhotos(serverReserves, pendingPhotos), [serverReserves, pendingPhotos]);

  useEffect(() => {
    void refreshPendingPhotos();
    const onQueueChanged = (e: Event) => {
      if ((e as CustomEvent).detail?.entity === photoEntity) void refreshPendingPhotos();
    };
    const onPhotoSynced = (e: Event) => {
      const { id, entity: syncedEntity, data } = (e as CustomEvent).detail || {};
      if (syncedEntity !== photoEntity) return;
      // La photo enregistrée remplace son aperçu : on l'ajoute à la réserve lue avant de relire la file.
      if (data?.file_url) {
        setReserves(prev => prev.map(r => r.id === data.reserve_id && !(r.photos || []).some((p: ReservePhoto) => p.id === data.id)
          ? { ...r, photos: [...(r.photos || []), { ...data, pendingSync: false }] }
          : r));
        releasePreviewUrl(id);
      }
      void refreshPendingPhotos();
    };
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onQueueChanged);
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onPhotoSynced);
    // Fin d'un passage d'envoi : une photo refusée par le serveur change d'état sans autre signal.
    const unsubscribe = subscribeReplayProgress(() => { if (!getReplayProgress().running) void refreshPendingPhotos(); });
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, onQueueChanged);
      window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onPhotoSynced);
      unsubscribe();
    };
  }, [photoEntity, refreshPendingPhotos, setReserves]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [annotationCoords, setAnnotationCoords] = useState<{ x: number; y: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [openReserveId, setOpenReserveId] = useState<string | null>(null);

  // Affichage progressif (src/lib/reservePagination.ts) : un OPR compte des centaines, parfois des
  // milliers de réserves. Seules les `limit` premières lignes sont rendues, la suite vient au défilement.
  // Un seul rendu à la fois (liste mobile OU tableau) : les deux étaient montés, l'un masqué par CSS.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [limit, setLimit] = useState(RESERVE_PAGE_SIZE);
  const [revealId, setRevealId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialOpenReserveId || reserves.length === 0) return;
    if (reserves.some(r => r.id === initialOpenReserveId)) setOpenReserveId(initialOpenReserveId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenReserveId, reserves]);
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
      const hay = [r.title, r.batiment, r.local, r.description, r.reponse, ...parseJsonList(r.lots), ...parseJsonList(r.entreprises), String(r.number ?? '')]
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

  const isGroupExpanded = useCallback((key: string) => expandedGroups[key] ?? true, [expandedGroups]);
  // Seule la présentation active est paginée : l'autre n'est pas montée.
  const flatPage = useMemo(() => (isDesktop ? null : paginateFlat(mobileList, limit)), [isDesktop, mobileList, limit]);
  const groupsPage = useMemo(() => (isDesktop ? paginateGroups(groups, limit, isGroupExpanded) : null), [isDesktop, groups, limit, isGroupExpanded]);
  const shownCount = flatPage?.shown ?? groupsPage?.shown ?? 0;
  const totalCount = flatPage?.total ?? groupsPage?.total ?? 0;
  const showMore = useCallback(() => setLimit(l => nextLimit(l)), []);

  // Un autre filtre ou une autre recherche repart de la première page : sinon on resterait sur une
  // fenêtre de 500 lignes pour trois résultats, ou en bas d'une liste qui n'existe plus.
  useEffect(() => { setLimit(RESERVE_PAGE_SIZE); }, [filter, search]);

  // Une réserve qu'on vient de créer se montre même si elle tombe au-delà de la fenêtre (elle clôt son
  // lot dans le tableau, et la liste mobile est triée du plus récent au plus ancien).
  useEffect(() => {
    if (!revealId || !reserves.some(r => r.id === revealId)) return;
    const rank = isDesktop
      ? rankInGroups(groups, isGroupExpanded, r => r.id, revealId)
      : rankInFlat(mobileList, r => r.id, revealId);
    if (rank !== null) setLimit(l => limitToReveal(rank, l));
    setRevealId(null);
  }, [revealId, isDesktop, groups, mobileList, isGroupExpanded, reserves]);

  const entity = apiBase === '/api/gpa-reserves' ? 'gpaReserve' : 'reserve';

  // Lève le badge « en attente » d'une réserve dès que sa création a
  // effectivement atteint le serveur (voir src/lib/offlineQueue.ts).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { id, entity: syncedEntity } = (e as CustomEvent).detail || {};
      if (syncedEntity !== entity) return;
      setReserves(prev => prev.map(r => r.id === id ? { ...r, pendingSync: false } : r));
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
  }, [entity, setReserves]);

  const changeStatus = async (res: ReserveLike, status: ReserveLike['status']) => {
    const updated = { ...res, status };
    try {
      await queuedJsonRequest({ entity, id: window.crypto.randomUUID(), method: 'PUT', url: `${apiBase}/${res.id}`, body: updated });
      setReserves(prev => prev.map(r => r.id === res.id ? updated : r));
    } catch (err) { console.error(err); }
  };

  const deleteReserve = async (res: ReserveLike) => {
    if (!confirm(t('reserve_tracker_confirm_delete', { number: res.number ?? '' }))) return;
    try {
      await queuedJsonRequest({ entity, id: window.crypto.randomUUID(), method: 'DELETE', url: `${apiBase}/${res.id}` });
      setReserves(prev => prev.filter(r => r.id !== res.id));
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
        {first.pendingSync ? (
          <img src={first.localPreviewUrl} alt="" className="w-full h-full object-cover rounded-lg opacity-90" />
        ) : (
          // Une liste peut compter des centaines de réserves : seules les miniatures qui approchent de
          // l'écran sont demandées (URL signée puis image), le reste attend le défilement.
          <ReservePhotoImage photo={first} alt="" className="w-full h-full object-cover rounded-lg" deferUntilVisible />
        )}
        {(r.photos?.length || 0) > 1 && (
          <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/60 text-white text-[0.6875rem] font-bold">{r.photos!.length}</span>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label={`${shortTitle ?? title} ouvertes`} color="blue" icon={IconAlertTriangle} value={reserveStats.ouvertes} sub="A faire + En cours" />
        <StatTile label="En retard" color="red" icon={IconAlertCircle} value={reserveStats.retard} sub="Échéance dépassée" />
        <StatTile label="Urgentes" color="orange" icon={IconClock} value={reserveStats.urgentes} sub="Dans les 7 jours" />
        <StatTile label="Levées" color="green" icon={IconCheck} value={reserveStats.levees} sub="Levée + Quitus" />
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <CardHeader
          icon={IconClipboardCheck}
          title={title}
          action={
            // Sur téléphone, les trois commandes remplissent la ligne sous le titre au lieu de se tasser à droite.
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:justify-end">
              {plans.length > 0 && (
                <select
                  aria-label="Plan"
                  className="flex-1 min-w-0 sm:flex-none bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg px-3 py-2 pointer-coarse:min-h-11 text-sm font-bold outline-none sm:max-w-[160px]"
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
                className="flex items-center justify-center gap-2 px-3 py-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] rounded-lg text-sm font-bold transition disabled:opacity-50"
                title="Exporter la liste de réserves en PDF"
                aria-label="Exporter la liste de réserves en PDF"
              >
                {exporting ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileTypePdf size={14} />}
                <span className="hidden sm:inline">{exporting || 'Exporter PDF'}</span>
              </button>
              <button
                onClick={openForCreation}
                className="flex flex-1 sm:flex-none items-center justify-center gap-2 whitespace-nowrap px-4 py-2 pointer-coarse:min-h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition"
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
            <div className="h-[60dvh] sm:h-[500px]">
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
                  'px-3 py-1.5 rounded-full text-sm font-bold transition-colors pointer-coarse:min-h-11',
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
              className="w-full pl-8 pr-3 py-1.5 pointer-coarse:min-h-11 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-800 border-none outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="text-xs text-[var(--tblr-muted)] font-medium">{visible.length} / {reserves.length}</span>
        </div>

        {/* Mobile : une carte par réserve */}
        {!isDesktop && (
        <div className="divide-y divide-[var(--tblr-border)]">
          {(flatPage?.items ?? []).map(res => {
            const retard = reserveOverdueDays(res);
            const entreprises = parseJsonList(res.entreprises);
            const lots = parseJsonList(res.lots);
            return (
              // Le statut est un <select> : il ne peut pas vivre dans le <button> qui ouvre la fiche
              // (contrôles imbriqués) et sa pastille, large comme la plus longue option, débordait de la carte.
              <div key={res.id} className={cn('px-3 py-3', retard > 0 && 'bg-red-50/40 dark:bg-red-950/10')}>
              <button
                type="button"
                onClick={() => setOpenReserveId(res.id)}
                className="w-full text-left flex gap-3 active:bg-[var(--tblr-surface-2)]"
              >
                {renderThumb(res, 'w-16 h-16 shrink-0')}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-xs font-bold text-[var(--tblr-muted)] pt-0.5">#{res.number ?? '-'}</span>
                    <span className="font-semibold text-sm text-[var(--tblr-text)] leading-snug line-clamp-2">{res.title}</span>
                    {res.pendingSync && (
                      <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-bold flex-shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">en attente</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--tblr-muted)] truncate">
                    {[entreprises.join(', ') || lots.join(', '), [res.batiment, res.local].filter(Boolean).join(' / ')].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {res.reponse && (
                    <div className="flex items-start gap-1 text-xs text-[var(--tblr-text)]">
                      <IconMessage size={12} className="mt-0.5 shrink-0 text-[var(--tblr-primary)]" aria-label="Suivi" />
                      <span className="line-clamp-2">{res.reponse}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-medium', retard > 0 ? 'text-red-600' : 'text-[var(--tblr-muted)]')}>
                      {res.due_date ? new Date(res.due_date).toLocaleDateString('fr-FR') : 'Sans échéance'}
                      {retard > 0 && <span className="ml-1 px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[0.6875rem] font-bold">+{retard}j</span>}
                    </span>
                  </div>
                </div>
              </button>
              {/* Aligné sur la colonne de texte : vignette de 4 rem + espacement de 0,75 rem. */}
              <div className="mt-2 pl-[4.75rem]">
                <StatusSelect value={res.status} onChange={s => changeStatus(res, s)} className="max-w-full min-h-9 pointer-coarse:min-h-11 px-3 text-xs" />
              </div>
              </div>
            );
          })}
          {mobileList.length === 0 && (
            <div className="px-6 py-8 text-center text-[var(--tblr-muted)] italic text-sm">Aucune réserve.</div>
          )}
        </div>
        )}

        {/* Bureau : tableau groupé par lot / entreprise */}
        {isDesktop && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] font-bold uppercase text-[0.6875rem] tracking-wider">
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
              {(groupsPage?.groups ?? []).map(({ key: groupKey, rows: groupRows, total: groupTotal, expanded }) => {
                return (
                  <React.Fragment key={groupKey}>
                    <tr
                      className="bg-zinc-50/50 dark:bg-zinc-800/20 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/40 transition-colors"
                      onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: !expanded }))}
                    >
                      <td colSpan={8} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {expanded ? <IconChevronDown size={14} className="text-[var(--tblr-muted)]" /> : <IconChevronRight size={14} className="text-[var(--tblr-muted)]" />}
                          <span className="font-bold text-[var(--tblr-text)] uppercase tracking-wider text-[0.6875rem]">{groupKey}</span>
                          <span className="text-[0.6875rem] text-[var(--tblr-muted)] font-normal">({groupTotal} réserve{groupTotal > 1 ? 's' : ''})</span>
                        </div>
                      </td>
                    </tr>
                    {expanded && groupRows.map(res => {
                      const retard = reserveOverdueDays(res);
                      return (
                        <tr
                          key={res.id}
                          onClick={() => setOpenReserveId(res.id)}
                          className={cn('transition-colors group cursor-pointer', retard > 0 ? 'bg-red-50/30 dark:bg-red-950/10 hover:bg-red-50/50' : 'hover:bg-[var(--tblr-surface-2)]')}
                        >
                          <td className="px-4 py-3 font-mono text-[0.6875rem] text-[var(--tblr-muted)]">#{res.number || '-'}</td>
                          <td className="px-4 py-2">{renderThumb(res, 'w-12 h-12')}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[var(--tblr-text)] flex items-center gap-1.5">
                              {res.title}
                              {res.pendingSync && (
                                <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-bold flex-shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">en attente</span>
                              )}
                            </div>
                            {res.description && <div className="text-[0.6875rem] text-[var(--tblr-muted)] line-clamp-1">{res.description}</div>}
                            {res.reponse && (
                              <div className="flex items-start gap-1 text-[0.6875rem] text-[var(--tblr-text)] line-clamp-2" title={res.reponse}>
                                <IconMessage size={12} className="mt-0.5 shrink-0 text-[var(--tblr-primary)]" aria-label="Suivi" />
                                <span className="line-clamp-2">{res.reponse}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{[res.batiment, res.local].filter(Boolean).join(' / ') || '—'}</td>
                          <td className="px-4 py-3"><StatusSelect value={res.status} onChange={s => changeStatus(res, s)} /></td>
                          <td className="px-4 py-3 text-[0.6875rem] text-[var(--tblr-muted)]">{res.created_at ? new Date(res.created_at).toLocaleDateString('fr-FR') : ''}</td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <div className={cn('text-xs font-medium', retard > 0 ? 'text-red-500' : 'text-zinc-600 dark:text-zinc-300')}>
                                {res.due_date ? new Date(res.due_date).toLocaleDateString('fr-FR') : '—'}
                              </div>
                              {retard > 0 && (
                                <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[0.6875rem] font-bold">+{retard}j</span>
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
                  <td colSpan={8} className="px-6 py-8 text-left sm:text-center text-[var(--tblr-muted)] italic"><span className="table-empty-message">Aucune réserve.</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        <ListFooter shown={shownCount} total={totalCount} onMore={showMore} />
      </div>

      <AnimatePresence>
      {(creating || openReserve) && (
        <ReserveDetail
          key={creating ? 'new' : openReserve!.id}
          apiBase={apiBase}
          projectId={projectId}
          reserve={creating ? null : openReserve}
          plans={plans}
          lotsList={lotsList}
          pendingPlan={creating ? { planId: selectedPlanId, x: annotationCoords?.x, y: annotationCoords?.y } : null}
          onClose={() => { setCreating(false); setOpenReserveId(null); }}
          onSaved={saved => {
            // Une réserve créée est montrée même au-delà de la fenêtre affichée (voir revealId).
            if (!serverReserves.some(r => r.id === saved.id)) setRevealId(saved.id);
            setReserves(prev => prev.some(r => r.id === saved.id) ? prev.map(r => r.id === saved.id ? saved : r) : [...prev, saved]);
            setAnnotationCoords(null);
          }}
          onDeleted={id => setReserves(prev => prev.filter(r => r.id !== id))}
        />
      )}
      </AnimatePresence>
    </>
  );
}

/**
 * Pied de la liste : « 50 sur 312 affichées » et la suite. La suite se charge toute seule quand le pied
 * approche de l'écran (défilement au doigt) ; le bouton reste pour le clavier et pour un navigateur sans
 * IntersectionObserver. Ne s'affiche pas pour une liste vide.
 */
function ListFooter({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const { t } = useTranslation();
  const sentinel = useRef<HTMLDivElement>(null);
  const remaining = total - shown;

  // Recréé à chaque page : si le pied est encore à l'écran après l'ajout (grand écran), l'observateur
  // le signale de nouveau et la page suivante vient, jusqu'à ce que le pied sorte du champ.
  useEffect(() => {
    const el = sentinel.current;
    if (remaining <= 0 || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onMore();
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [remaining, shown, onMore]);

  if (total === 0) return null;
  return (
    <div ref={sentinel} className="px-3 sm:px-4 py-3 border-t border-[var(--tblr-border)] flex items-center justify-between gap-3 flex-wrap">
      <span className="text-xs text-[var(--tblr-muted)] font-medium" aria-live="polite">{t('reserve_tracker_shown_of', { shown, total })}</span>
      {remaining > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="px-4 py-2 pointer-coarse:min-h-11 rounded-lg text-sm font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)]"
        >
          {t('reserve_tracker_show_more', { count: nextChunk(shown, total) })}
        </button>
      )}
    </div>
  );
}

export default ReserveTracker;
