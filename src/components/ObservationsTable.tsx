import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  ColumnFiltersState,
  VisibilityState,
  ColumnSizingState,
} from '@tanstack/react-table';
import { IconPlus, IconTrash, IconColumns, IconArrowsExchange, IconCopyPlus, IconChevronDown, IconChevronRight, IconLayoutRows, IconArrowRight, IconFileTypePdf, IconPrinter } from '@tabler/icons-react';
import { useConfirmDialog } from './ui/ConfirmDialog';
import { DialogShell } from './projectDetail/situations/DialogShell';
import { Observation, ProjectLot } from '../types';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { queuedJsonRequest, OFFLINE_WRITE_SYNCED_EVENT } from '../lib/offlineQueue';
import { reconcileRemote, upsertById } from '../lib/observationsLocal';
import { fetchAgencySettings } from '../lib/pdfLetterhead';
import { cachedListFirst } from '../lib/offlineReadCache';
import { SANS_AFFECTATION, DECOUPAGE_VIDE, batimentsActifs, phasesActives, correspondDecoupage, type DecoupageChantier, type FiltreDecoupage } from '../lib/chantierDecoupage';
import { DecoupageFilters, DecoupageSelects } from './chantier/DecoupageFields';
import { ObservationLotPicker, type LotChoice } from './chantier/ObservationLotPicker';
import { observationSelectedLotIds, observationTargetsLot, TCE_FULL_LABEL, TCE_LABEL } from '../lib/observationLots';
import { db } from '../db';
import { apiFetch } from '../lib/api';
import { isReprenable } from '../lib/observationsReserves';

interface Props {
  projectId: string;
  lots: ProjectLot[];
  /** Bâtiments et phases du chantier : colonne, filtres et affectation par ligne quand il y en a. */
  decoupage?: DecoupageChantier;
  reportId?: string;
  currentReportId?: string;
  /** Restricts the table to one observation type (e.g. 'reserve' for the "Réserves" tab). */
  typeFilter?: Observation['type'];
  /** Nature donnée aux lignes ajoutées quand aucun `typeFilter` ne l'impose. */
  defaultType?: Observation['type'];
  /** Appelé quand des réserves de l'AOR viennent d'être créées (pour rafraîchir leur liste). */
  onReservesChanged?: () => void;
  /** Appelé après un ajout ou une suppression : les autres vues du chantier relisent leurs observations. */
  onChanged?: () => void;
  /** Affaire : nom et code imprimés sur l'export PDF et l'impression. */
  project?: { name: string; project_code?: string; address?: string; client?: string };
  /** Ouvre la vue sur « Ouverts seulement » (revue des observations non levées depuis le compte-rendu). */
  initialOpenOnly?: boolean;
}

const TYPE_LABELS: Record<NonNullable<Observation['type']>, string> = {
  observation: 'Remarque',
  reserve: 'À lever',
  a_faire: 'Travail à faire',
};

const STATUTS = ['À faire', 'En cours', 'Levée', 'Urgent', 'Refusée'] as const;

const statutColors: Record<string, string> = {
  'À faire': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'En cours': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'Levée': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'Urgent': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  'Refusée': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const URGENCES = ['normal', 'urgent', 'bloquant'] as const;

const urgenceColors: Record<string, string> = {
  normal: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  urgent: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  bloquant: 'bg-red-600 text-white',
};

const columnHelper = createColumnHelper<Observation>();

/** Zone de texte qui s'agrandit avec son contenu (retours à la ligne conservés). */
function AutoTextarea({ value, onCommit, className, placeholder, id }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; id?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  // Recalcule aussi quand la colonne est redimensionnée (largeur du parent).
  useEffect(() => {
    // Champ non contrôlé : une valeur qui change hors saisie (relecture du serveur, liste décalée)
    // doit être reprise, sinon le champ garde le texte d'une autre observation.
    const current = ref.current;
    if (current && document.activeElement !== current && current.value !== value) current.value = value;
    fit();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [fit, value]);
  return (
    <textarea
      ref={ref}
      id={id}
      rows={1}
      className={className}
      defaultValue={value}
      placeholder={placeholder}
      onInput={fit}
      // Rien n'est enregistré si le texte n'a pas changé : passer dans un champ sans le modifier
      // ne doit jamais écrire son contenu affiché sur une observation.
      onBlur={e => { if (e.target.value !== value) onCommit(e.target.value); }}
    />
  );
}

const COLUMN_LABELS: Record<string, string> = {
  number: 'N°',
  lot: 'Lot',
  decoupage: 'Bât. / phase',
  type: 'Nature',
  texte: 'Observation',
  statut: 'Statut',
  urgence: 'Urgence',
  due_date: 'Délai',
  created_report_number: 'CR émis',
  resolved_report_number: 'CR levée',
  photos: 'Photos',
  aor: 'Réserve AOR',
  actions: '',
};

export default function ObservationsTable({ projectId, lots, decoupage = DECOUPAGE_VIDE, reportId, currentReportId, typeFilter, defaultType, onReservesChanged, onChanged, project, initialOpenOnly = false }: Props) {
  const { t } = useTranslation();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [lotFilter, setLotFilter] = useState('');
  const [openOnly, setOpenOnly] = useState(initialOpenOnly);
  // Observations dont la réponse est dépliée (flèche à gauche de la ligne).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const [filtreDecoupage, setFiltreDecoupage] = useState<FiltreDecoupage>({ batimentId: '', phaseId: '' });
  const aDecoupage = batimentsActifs(decoupage).length + phasesActives(decoupage).length > 0;
  const [typeSelect, setTypeSelect] = useState('');
  const [aorMessage, setAorMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const storeKey = `obsTable:${typeFilter || 'all'}`;
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try { return JSON.parse(localStorage.getItem(`${storeKey}:sizes`) || '{}'); } catch { return {}; }
  });
  // Lot en en-tête : libère la colonne Lot au profit de l'observation.
  const [groupByLot, setGroupByLot] = useState<boolean>(() => {
    try { return localStorage.getItem(`${storeKey}:groupByLot`) !== '0'; } catch { return true; }
  });
  // Colonnes masquées : mémorisées par poste, comme les largeurs.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`${storeKey}:visibility`) || '{}');
      return stored && typeof stored === 'object' ? stored : {};
    } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(`${storeKey}:visibility`, JSON.stringify(columnVisibility)); } catch {} }, [columnVisibility, storeKey]);
  useEffect(() => { try { localStorage.setItem(`${storeKey}:sizes`, JSON.stringify(columnSizing)); } catch {} }, [columnSizing, storeKey]);
  useEffect(() => { try { localStorage.setItem(`${storeKey}:groupByLot`, groupByLot ? '1' : '0'); } catch {} }, [groupByLot, storeKey]);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const endpoint = reportId
    ? `/api/reports/${reportId}/observations`
    : `/api/projects/${projectId}/observations`;

  // Cache d'abord (src/lib/offlineReadCache.ts) : hors-ligne, les
  // observations déjà consultées pour cette affaire/ce compte rendu restent
  // affichées plutôt que de disparaître.
  const scopeFilter = useCallback(
    (o: Observation) => (reportId ? (o.report_ids || []).includes(reportId) : o.project_id === projectId),
    [reportId, projectId],
  );

  // Lignes supprimées / créées ici : une relecture partie avant l'action et revenue après
  // ne doit ni faire réapparaître une suppression ni faire disparaître une création.
  const observationsRef = useRef<Observation[]>([]);
  observationsRef.current = observations;
  const supprimesRef = useRef(new Set<string>());
  const creeesRef = useRef(new Set<string>());

  const fetchObservations = useCallback(() => {
    setLoadError(false);
    const appliquer = (liste: Observation[]) =>
      setObservations(prev => reconcileRemote(liste, prev, supprimesRef.current, creeesRef.current));
    cachedListFirst(db.observationsCache, scopeFilter, endpoint, appliquer)
      .then(({ hadLocalData, synced }) => { if (!hadLocalData && !synced) setLoadError(true); })
      .catch(err => { console.error(err); setLoadError(true); });
  }, [endpoint, scopeFilter]);

  useEffect(() => { fetchObservations(); }, [fetchObservations]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const saveField = useCallback((id: string, field: string, value: string) => {
    clearTimeout(debounceRef.current[id + field]);
    debounceRef.current[id + field] = setTimeout(() => {
      queuedJsonRequest({ entity: 'observation', id: crypto.randomUUID(), method: 'PUT', url: `/api/observations/${id}`, body: { [field]: value } })
        .then(() => setSaveError(false))
        // The optimistic update already landed in local state regardless of
        // outcome — a failed PUT here means the UI can be showing an edit
        // the server never persisted, silently, with nothing to tell the
        // user their change didn't stick (see 2026-09-08 incident: writes
        // occasionally 500 transiently with no corresponding DB error).
        // Hors-ligne, la modification est mise en file (src/lib/offlineQueue.ts)
        // plutôt que rejetée : ce n'est donc plus un échec ici.
        .catch(err => { console.error(err); setSaveError(true); });
    }, 300);
  }, []);

  const updateLocal = useCallback((id: string, patch: Partial<Observation>) => {
    setObservations(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  }, []);

  // Nouvelle attribution (un autre lot, plusieurs lots, ou TCE) : la ligne change de groupe tout de suite.
  const assignLots = useCallback((id: string, choice: LotChoice) => {
    const lot = lots.find(l => l.id === choice.lot_id);
    updateLocal(id, {
      lot_id: choice.lot_id ?? undefined, lot_ids: choice.lot_ids, tce: choice.tce, contact_id: choice.contact_id ?? undefined,
      lot: lot ? { id: lot.id, lot_number: lot.lot_number, lot_title: lot.lot_title } : undefined,
    });
    queuedJsonRequest({
      entity: 'observation', id: crypto.randomUUID(), method: 'PUT', url: `/api/observations/${id}`,
      body: { lot_id: choice.lot_id, lot_ids: choice.lot_ids, tce: choice.tce, contact_id: choice.contact_id },
    }).then(() => { setSaveError(false); onChangedRef.current?.(); }).catch(err => { console.error(err); setSaveError(true); });
  }, [lots, updateLocal]);

  // Lève le badge « en attente » d'une observation dès que sa création a
  // effectivement atteint le serveur (voir src/lib/offlineQueue.ts).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { id, entity } = (e as CustomEvent).detail || {};
      if (entity !== 'observation') return;
      setObservations(prev => prev.map(o => o.id === id ? { ...o, pendingSync: false } : o));
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
  }, []);

  // Crée une observation : elle apparaît tout de suite (en attente), puis le serveur confirme.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const createObservation = useCallback(async (body: Record<string, unknown> & { id: string }): Promise<boolean> => {
    const id = body.id;
    const lot = lots.find(l => l.id === body.lot_id);
    const provisoire = { ...body, project_id: projectId, pendingSync: true, lot: lot ? { id: lot.id, lot_number: lot.lot_number, lot_title: lot.lot_title } : undefined } as unknown as Observation;
    creeesRef.current.add(id);
    setObservations(prev => upsertById(prev, provisoire));
    try {
      const { queued, data } = await queuedJsonRequest<Observation>({ entity: 'observation', id, method: 'POST', url: `/api/projects/${projectId}/observations`, body });
      if (!queued && data) {
        setObservations(prev => upsertById(prev, { ...data, lot: provisoire.lot }));
        db.observationsCache.put(data).catch(() => {});
        creeesRef.current.delete(id);
      }
      return true;
    } catch (err) {
      console.error(err);
      creeesRef.current.delete(id);
      setObservations(prev => prev.filter(o => o.id !== id));
      setSaveError(true);
      return false;
    }
  }, [lots, projectId]);

  // Une ligne ajoutée à la fois : un second appui avant la réponse du serveur créait une seconde observation.
  const addingRef = useRef(false);
  const addRow = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    try {
      // Id généré côté client : une création rejouée après coupure réseau
      // (file de synchro hors-ligne) ne crée jamais deux observations.
      const ok = await createObservation({ id: crypto.randomUUID(), texte: '', statut: 'À faire', type: typeFilter || defaultType || 'observation', created_report_id: currentReportId || undefined,
        // Une ligne ajoutée sous un filtre de bâtiment ou de phase y est affectée d'office.
        batiment_id: filtreDecoupage.batimentId && filtreDecoupage.batimentId !== SANS_AFFECTATION ? filtreDecoupage.batimentId : null,
        phase_id: filtreDecoupage.phaseId && filtreDecoupage.phaseId !== SANS_AFFECTATION ? filtreDecoupage.phaseId : null,
      });
      if (ok) onChanged?.();
    } finally {
      addingRef.current = false;
    }
  };

  // Nouvelle remarque pour la même entreprise (même lot, mêmes bâtiment et phase) : on saisit à la suite.
  const addRowSameCompany = useCallback(async (source: Observation) => {
    const ok = await createObservation({
      id: crypto.randomUUID(), texte: '', statut: 'À faire', type: source.type || typeFilter || defaultType || 'observation',
      lot_id: source.lot_id || null, contact_id: source.contact_id || null, created_report_id: currentReportId || undefined,
      batiment_id: source.batiment_id || null, phase_id: source.phase_id || null,
    });
    if (ok) onChangedRef.current?.();
  }, [createObservation, currentReportId, typeFilter, defaultType]);

  // Changer d'entreprise (la remarque passe au lot choisi) ou l'attribuer aussi à d'autres entreprises (une copie par lot).
  const [reattribution, setReattribution] = useState<{ id: string; mode: 'changer' | 'ajouter'; lotIds: string[]; busy: boolean } | null>(null);
  const appliquerReattribution = async () => {
    if (!reattribution || reattribution.lotIds.length === 0) return;
    const source = observationsRef.current.find(o => o.id === reattribution.id);
    if (!source) { setReattribution(null); return; }
    setReattribution({ ...reattribution, busy: true });
    if (reattribution.mode === 'changer') {
      const lot = lots.find(l => l.id === reattribution.lotIds[0]);
      if (lot) {
        updateLocal(source.id, { lot_id: lot.id, lot: { id: lot.id, lot_number: lot.lot_number, lot_title: lot.lot_title }, contact_id: lot.contact_id || source.contact_id });
        try {
          await queuedJsonRequest({ entity: 'observation', id: crypto.randomUUID(), method: 'PUT', url: `/api/observations/${source.id}`, body: { lot_id: lot.id, ...(lot.contact_id ? { contact_id: lot.contact_id } : {}) } });
          setSaveError(false);
        } catch (err) { console.error(err); setSaveError(true); }
      }
    } else {
      for (const lotId of reattribution.lotIds) {
        const lot = lots.find(l => l.id === lotId);
        await createObservation({
          id: crypto.randomUUID(), texte: source.texte, statut: 'À faire', type: source.type || 'observation', urgence: source.urgence || 'normal',
          due_date: source.due_date || undefined, lot_id: lotId, contact_id: lot?.contact_id || undefined,
          created_report_id: currentReportId || undefined, batiment_id: source.batiment_id || null, phase_id: source.phase_id || null,
        });
      }
    }
    setReattribution(null);
    onChanged?.();
  };

  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();

  const deleteRow = useCallback(async (id: string) => {
    const confirmed = await confirmAction({
      title: t('observations_table_confirm_delete'),
      confirmLabel: t('projectdetail_dialog_delete'),
      cancelLabel: t('projectdetail_dialog_cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    // Suppression immédiate à l'écran et dans le cache hors-ligne ; la requête suit.
    const retiree = observationsRef.current.find(o => o.id === id);
    supprimesRef.current.add(id);
    creeesRef.current.delete(id);
    setObservations(prev => prev.filter(o => o.id !== id));
    db.observationsCache.delete(id).catch(() => {});
    try {
      await queuedJsonRequest({ entity: 'observation', id: crypto.randomUUID(), method: 'DELETE', url: `/api/observations/${id}` });
      onChanged?.();
    } catch (err) {
      console.error(err);
      // Refus du serveur : la ligne revient à sa place, avec un message.
      supprimesRef.current.delete(id);
      if (retiree) { const r = retiree; setObservations(prev => upsertById(prev, r)); db.observationsCache.put(r).catch(() => {}); }
      setSaveError(true);
    }
  }, [confirmAction, t, onChanged]);

  // Reprise en réserve de l'AOR (OPR) : l'observation reste en place et affiche
  // le numéro de sa réserve. En ligne seulement : la numérotation est tenue par le serveur.
  const reprendreEnReserve = useCallback(async (id: string) => {
    const confirmed = await confirmAction({
      title: "Reprendre cette observation en réserve de l'AOR ?",
      message: "Une réserve est créée dans l'onglet Réception (AOR), avec le lot, l'entreprise et le délai de l'observation. L'observation reste dans les comptes-rendus.",
      confirmLabel: 'Reprendre en réserve',
      cancelLabel: t('projectdetail_dialog_cancel'),
      tone: 'primary',
    });
    if (!confirmed) return;
    try {
      const created = await apiFetch<{ reserve_id: string; number: number }>(`/api/observations/${id}/to-reserve`, { method: 'POST' });
      updateLocal(id, { reserve_id: created.reserve_id, reserve_number: created.number });
      setAorMessage({ tone: 'ok', text: `Réserve n° ${created.number} créée dans l'AOR.` });
      onReservesChanged?.();
    } catch (err: any) {
      setAorMessage({ tone: 'error', text: err?.message || 'La reprise en réserve a échoué.' });
    }
  }, [confirmAction, t, updateLocal, onReservesChanged]);

  // TanStack Table expects `data` and `columns` to be referentially stable
  // across renders (its docs call this out explicitly): recreating either
  // as a fresh array every render — as this component did before — makes
  // its internal row-model memoization never hit, which for a non-empty
  // table caused an unbounded render loop (confirmed by rendering this
  // component with real data outside the browser: it never settles). Data
  // with zero rows never hit this because there was no row model diverging
  // for the memoization to keep rebuilding — see the 2026-09-08 incident.
  const filtered = useMemo(() => observations.filter(o => {
    if (typeFilter && (o.type || 'observation') !== typeFilter) return false;
    if (typeSelect && (o.type || 'observation') !== typeSelect) return false;
    if (openOnly && o.statut === 'Levée') return false;
    if (statusFilter && o.statut !== statusFilter) return false;
    if (lotFilter && !observationTargetsLot(o, lotFilter)) return false;
    if (!correspondDecoupage(o, filtreDecoupage)) return false;
    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      return (o.texte || '').toLowerCase().includes(q) ||
        (o.lot?.lot_title || '').toLowerCase().includes(q);
    }
    return true;
  }), [observations, typeFilter, typeSelect, openOnly, statusFilter, lotFilter, filtreDecoupage, globalFilter]);

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'expand',
      size: 36,
      cell: info => {
        const row = info.row.original;
        const open = expanded.has(row.id);
        return (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Replier la réponse' : 'Déplier la réponse'}
            title={row.reponse ? 'Réponse saisie' : 'Saisir une réponse'}
            onClick={() => toggleExpanded(row.id)}
            className="flex items-center gap-0.5 p-1.5 rounded text-zinc-400 hover:text-[var(--tblr-primary)]"
          >
            <IconChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {row.reponse ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--tblr-primary)]" aria-hidden="true" /> : null}
          </button>
        );
      },
    }),
    columnHelper.accessor('number', {
      header: 'N°',
      size: 48,
      cell: info => (
        <span className="font-mono text-xs text-zinc-400">#{String(info.getValue() || '').padStart(2, '0')}</span>
      ),
    }),
    columnHelper.accessor('lot', {
      id: 'lot',
      header: 'Lot',
      size: 140,
      cell: info => {
        const row = info.row.original;
        return <ObservationLotPicker obs={row} lots={lots} onApply={choice => assignLots(row.id, choice)} className="w-full" />;
      },
    }),
    ...(aDecoupage ? [columnHelper.display({
      id: 'decoupage',
      header: 'Bât. / phase',
      size: 190,
      cell: info => {
        const row = info.row.original;
        return (
          <DecoupageSelects
            decoupage={decoupage}
            batimentId={row.batiment_id}
            phaseId={row.phase_id}
            className="flex flex-col gap-1"
            onChange={patch => {
              updateLocal(row.id, patch);
              const [champ, valeur] = Object.entries(patch)[0] as [string, string | null];
              saveField(row.id, champ, valeur || '');
            }}
          />
        );
      },
    })] : []),
    columnHelper.accessor('texte', {
      header: 'Observation',
      size: 520,
      minSize: 200,
      cell: info => {
        const row = info.row.original;
        return (
          <div className="flex items-start gap-1.5">
            <AutoTextarea
              className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-[var(--tblr-primary)] rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm dark:text-white resize-none overflow-hidden whitespace-pre-wrap break-words leading-snug"
              value={info.getValue() || ''}
              placeholder="Saisir une observation..."
              onCommit={v => {
                updateLocal(row.id, { texte: v });
                saveField(row.id, 'texte', v);
              }}
            />
            {row.pendingSync && (
              <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-bold flex-shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">en attente</span>
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor('type', {
      header: 'Nature',
      size: 110,
      cell: info => {
        const row = info.row.original;
        const val = (info.getValue() || 'observation') as NonNullable<Observation['type']>;
        return (
          <select
            className="w-full p-1 rounded text-xs border border-zinc-200 dark:border-zinc-700 bg-transparent cursor-pointer"
            value={val}
            onChange={e => {
              updateLocal(row.id, { type: e.target.value as Observation['type'] });
              saveField(row.id, 'type', e.target.value);
            }}
          >
            {(Object.keys(TYPE_LABELS) as NonNullable<Observation['type']>[]).map(k => <option key={k} value={k}>{TYPE_LABELS[k]}</option>)}
          </select>
        );
      },
    }),
    columnHelper.accessor('statut', {
      header: 'Statut',
      size: 110,
      cell: info => {
        const row = info.row.original;
        const val = info.getValue() || 'À faire';
        return (
          <select
            className={`w-full p-1 rounded text-[0.6875rem] font-bold uppercase tracking-wider border-none cursor-pointer ${statutColors[val] || ''}`}
            value={val}
            onChange={e => {
              updateLocal(row.id, { statut: e.target.value as Observation['statut'] });
              saveField(row.id, 'statut', e.target.value);
            }}
          >
            {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        );
      },
    }),
    columnHelper.accessor('urgence', {
      header: 'Urgence',
      size: 100,
      cell: info => {
        const row = info.row.original;
        const val = info.getValue() || 'normal';
        return (
          <select
            className={`w-full p-1 rounded text-[0.6875rem] font-bold uppercase tracking-wider border-none cursor-pointer ${urgenceColors[val] || ''}`}
            value={val}
            onChange={e => {
              updateLocal(row.id, { urgence: e.target.value as Observation['urgence'] });
              saveField(row.id, 'urgence', e.target.value);
            }}
          >
            {URGENCES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        );
      },
    }),
    columnHelper.accessor('due_date', {
      header: 'Délai',
      size: 130,
      cell: info => {
        const row = info.row.original;
        return (
          <input
            type="date"
            className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-[var(--tblr-primary)] rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs dark:text-white"
            defaultValue={info.getValue() || ''}
            onBlur={e => {
              if (e.target.value === (row.due_date || '')) return;
              updateLocal(row.id, { due_date: e.target.value });
              saveField(row.id, 'due_date', e.target.value);
            }}
          />
        );
      },
    }),
    columnHelper.accessor('created_report_number', {
      header: 'CR émis',
      size: 72,
      cell: info => {
        const v = info.getValue();
        return v ? <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">#{String(v).padStart(2, '0')}</span> : null;
      },
    }),
    columnHelper.accessor('resolved_report_number', {
      header: 'CR levée',
      size: 72,
      cell: info => {
        const v = info.getValue();
        return v ? <span className="font-mono text-xs text-green-500">#{String(v).padStart(2, '0')}</span> : null;
      },
    }),
    columnHelper.accessor('photos', {
      header: 'Photos',
      size: 60,
      cell: info => {
        const photos = info.getValue() || [];
        if (photos.length === 0) return null;
        return (
          <button type="button" onClick={() => openSignedUrl(photos[0])} className="text-xs text-[var(--tblr-primary)] hover:underline">
            {photos.length} photo{photos.length > 1 ? 's' : ''}
          </button>
        );
      },
    }),
    columnHelper.display({
      id: 'aor',
      header: 'AOR',
      size: 120,
      cell: info => {
        const row = info.row.original;
        if (row.reserve_id) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300" title="Réserve de l'AOR qui reprend cette observation">
              <IconArrowRight size={13} /> Réserve n° {row.reserve_number ?? '—'}
            </span>
          );
        }
        if (!isReprenable(row) || row.pendingSync) return null;
        return (
          <button
            type="button"
            onClick={() => void reprendreEnReserve(row.id)}
            className="inline-flex items-center gap-1 text-xs text-[var(--tblr-primary)] hover:underline"
            title="Reprendre en réserve de l'AOR"
          >
            <IconArrowRight size={13} /> En réserve
          </button>
        );
      },
    }),
    columnHelper.display({
      id: 'actions',
      size: 96,
      cell: info => {
        const row = info.row.original;
        const discret = 'text-zinc-300 dark:text-zinc-600 p-1 rounded opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 transition';
        return (
          <div className="flex items-center justify-end gap-0.5">
            {!row.pendingSync && (
              <>
                <button type="button" onClick={() => void addRowSameCompany(row)} className={`${discret} hover:text-[var(--tblr-primary)]`}
                  title={t('observations_same_company')} aria-label={t('observations_same_company')}>
                  <IconCopyPlus size={15} />
                </button>
                <button type="button" onClick={() => setReattribution({ id: row.id, mode: 'changer', lotIds: [], busy: false })} className={`${discret} hover:text-[var(--tblr-primary)]`}
                  title={t('observations_reassign')} aria-label={t('observations_reassign')}>
                  <IconArrowsExchange size={15} />
                </button>
              </>
            )}
            <button type="button" onClick={() => void deleteRow(row.id)} className={`${discret} hover:text-red-500 dark:hover:text-red-400`}
              title={t('projectdetail_dialog_delete')} aria-label={t('projectdetail_dialog_delete')}>
              <IconTrash size={15} />
            </button>
          </div>
        );
      },
    }),
  ], [lots, decoupage, aDecoupage, saveField, updateLocal, assignLots, deleteRow, reprendreEnReserve, expanded, toggleExpanded, t, addRowSameCompany]);

  const table = useReactTable({
    data: filtered,
    columns,
    // Sans cela l'identifiant d'une ligne est sa position dans la liste : dès qu'une ligne apparaît ou
    // disparaît (ajout, suppression, filtre « Ouverts seulement »), les champs de saisie sont réutilisés
    // par une autre observation et lui écrivent le texte de la précédente.
    getRowId: observation => observation.id,
    state: { columnFilters, columnVisibility: groupByLot ? { ...columnVisibility, lot: false } : columnVisibility, columnSizing },
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    defaultColumn: { minSize: 40 },
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const lotGroups = useMemo(() => {
    const rows = table.getRowModel().rows;
    const groups: { key: string; label: string; rows: typeof rows }[] = [];
    // TCE d'abord ; une observation adressée à plusieurs lots figure sous chacun d'eux.
    const tceRows = rows.filter(x => x.original.tce);
    if (tceRows.length) groups.push({ key: 'tce', label: `${TCE_LABEL} · ${TCE_FULL_LABEL}`, rows: tceRows });
    lots.forEach(l => {
      const r = rows.filter(x => !x.original.tce && observationTargetsLot(x.original, l.id));
      if (r.length) groups.push({ key: l.id, label: `${l.lot_number} · ${l.lot_title}`, rows: r });
    });
    const orphans = rows.filter(x => !x.original.tce && !observationSelectedLotIds(x.original).some(id => lots.some(l => l.id === id)));
    if (orphans.length) groups.push({ key: 'none', label: 'Sans lot', rows: orphans });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getRowModel().rows, lots]);


  const allColumnIds = columns
    .map(c => ('accessorKey' in c ? String(c.accessorKey) : (c as any).id))
    .filter(id => id && id !== 'actions' && id !== 'number' && id !== 'expand');

  // Export PDF / impression : la liste telle qu'affichée (filtres, regroupement par lot).
  const [exporting, setExporting] = useState<'pdf' | 'print' | null>(null);
  const titreExport = typeFilter === 'reserve' || (!typeFilter && defaultType === 'reserve') ? 'Liste des réserves à lever' : 'Liste des observations';
  const lancerExport = async (mode: 'pdf' | 'print') => {
    const groupes = groupByLot && lotGroups.length > 0
      ? lotGroups.map(g => ({ label: g.label, items: g.rows.map(r => r.original) }))
      : [{ label: '', items: table.getRowModel().rows.map(r => r.original) }];
    if (groupes.every(g => g.items.length === 0)) { setSaveError(false); setAorMessage({ tone: 'error', text: 'Aucune ligne à exporter avec les filtres actuels.' }); return; }
    const filtres: string[] = [];
    if (globalFilter.trim()) filtres.push(`Recherche : ${globalFilter.trim()}`);
    const lotF = lots.find(l => l.id === lotFilter);
    if (lotF) filtres.push(`Lot : ${lotF.lot_number} ${lotF.lot_title}`);
    if (typeSelect) filtres.push(`Nature : ${TYPE_LABELS[typeSelect as keyof typeof TYPE_LABELS] || typeSelect}`);
    if (statusFilter) filtres.push(`Statut : ${statusFilter}`);
    if (openOnly) filtres.push('Ouvertes seulement');
    setExporting(mode);
    try {
      const [{ exportObservationsToPDF, telechargerPdf, imprimerPdf }, settings] = await Promise.all([
        import('../lib/observationsExport'), fetchAgencySettings(),
      ]);
      const pdf = await exportObservationsToPDF(groupes, project ?? { name: '' }, settings, { title: titreExport, filtres, decoupage });
      if (mode === 'print') imprimerPdf(pdf); else telechargerPdf(pdf);
    } catch (err) {
      console.error('[ObservationsTable] export', err);
      setAorMessage({ tone: 'error', text: "L'export n'a pas pu être généré." });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Rechercher..."
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] w-40"
        />
        <select
          value={lotFilter}
          onChange={e => setLotFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
        >
          <option value="">Tous les lots</option>
          {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {l.lot_title}</option>)}
        </select>
        <DecoupageFilters decoupage={decoupage} filtre={filtreDecoupage} onChange={setFiltreDecoupage} />
        <select
          value={typeSelect}
          onChange={e => setTypeSelect(e.target.value)}
          aria-label="Nature"
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
        >
          <option value="">Toutes les natures</option>
          {(Object.keys(TYPE_LABELS) as NonNullable<Observation['type']>[]).map(k => <option key={k} value={k}>{TYPE_LABELS[k]}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)]"
        >
          <option value="">Tous les statuts</option>
          {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} className="rounded" />
          Ouverts seulement
        </label>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none" title="Affiche le lot en titre de groupe plutôt qu'en colonne">
          <input type="checkbox" checked={groupByLot} onChange={e => setGroupByLot(e.target.checked)} className="rounded" />
          <IconLayoutRows size={15} /> Lot en en-tête
        </label>
        {Object.keys(columnSizing).length > 0 && (
          <button type="button" onClick={() => setColumnSizing({})} className="text-xs text-zinc-500 hover:underline">Réinitialiser les largeurs</button>
        )}
        <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => void lancerExport('pdf')} disabled={exporting !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50">
          <IconFileTypePdf size={15} /> {exporting === 'pdf' ? 'Génération…' : 'Exporter PDF'}
        </button>
        <button type="button" onClick={() => void lancerExport('print')} disabled={exporting !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50">
          <IconPrinter size={15} /> {exporting === 'print' ? 'Préparation…' : 'Imprimer'}
        </button>
        <div className="relative" ref={columnMenuRef}>
          <button
            onClick={() => setShowColumnMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
            <IconColumns size={15} />
            Colonnes
            <IconChevronDown size={13} />
          </button>
          {showColumnMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg p-3 min-w-[160px] space-y-1.5">
              {allColumnIds.filter(id => !(groupByLot && id === 'lot')).map(colId => {
                const col = table.getColumn(colId);
                if (!col) return null;
                return (
                  <label key={colId} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer hover:text-zinc-900 dark:hover:text-white">
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                      className="rounded"
                    />
                    {COLUMN_LABELS[colId] || colId}
                  </label>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>

      {aorMessage && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-2 rounded-xl border text-sm ${aorMessage.tone === 'ok'
            ? 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}
        >
          <span>{aorMessage.text}</span>
          <button type="button" onClick={() => setAorMessage(null)} className="text-xs underline shrink-0">Fermer</button>
        </div>
      )}

      {loadError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <span>Impossible de charger les observations (session expirée ou connexion interrompue).</span>
          <button
            onClick={fetchObservations}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition"
          >
            Réessayer
          </button>
        </div>
      )}
      {saveError && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
          <span>Une modification n'a pas pu être enregistrée (connexion interrompue). Rafraîchissez pour vérifier l'état réel avant de reprendre votre saisie.</span>
          <button
            onClick={() => { setSaveError(false); fetchObservations(); }}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition"
          >
            Rafraîchir
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-xl">
        <table className="text-sm border-collapse" style={{ tableLayout: 'fixed', width: table.getTotalSize(), minWidth: '100%' }}>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="relative p-2 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        title="Glisser pour régler la largeur (double clic : réinitialiser)"
                        className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-[var(--tblr-primary)] ${header.column.getIsResizing() ? 'bg-[var(--tblr-primary)]' : ''}`}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {table.getRowModel().rows.length > 0 ? (
              (groupByLot
                ? lotGroups
                : [{ key: 'all', label: '', rows: table.getRowModel().rows }]
              ).map(group => (
                <Fragment key={group.key}>
                  {groupByLot && (
                    <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                      <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                        {group.label} <span className="font-normal text-zinc-400">· {group.rows.length}</span>
                      </td>
                    </tr>
                  )}
                  {group.rows.map(row => (
                    <Fragment key={row.id}>
                      <tr className="group/row hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors align-top">
                        {row.getVisibleCells().map(cell => (
                          <td key={cell.id} className="p-1" style={{ width: cell.column.getSize() }}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                      {expanded.has(row.original.id) && (
                        <tr className="bg-[var(--tblr-surface-2)]">
                          <td />
                          <td colSpan={Math.max(1, table.getVisibleLeafColumns().length - 1)} className="px-3 py-3">
                            <label className="block text-[0.6875rem] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1" htmlFor={`reponse-${row.original.id}`}>Réponse</label>
                            <AutoTextarea
                              id={`reponse-${row.original.id}`}
                              className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 focus:ring-1 focus:ring-[var(--tblr-primary)] rounded text-sm dark:text-white resize-none overflow-hidden whitespace-pre-wrap break-words leading-snug"
                              value={row.original.reponse || ''}
                              placeholder="Réponse de l'entreprise ou de la maîtrise d'œuvre..."
                              onCommit={v => {
                                updateLocal(row.original.id, { reponse: v });
                                saveField(row.original.id, 'reponse', v);
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={table.getAllColumns().length} className="p-10 text-center text-zinc-400 italic text-sm">
                  Aucune observation. Cliquez sur "+ Nouvelle observation" pour en ajouter une.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addRow}
          className="w-full p-3 text-left text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition flex items-center gap-2 text-sm border-t border-zinc-100 dark:border-zinc-700 group"
        >
          <IconPlus size={15} className="text-zinc-400 group-hover:text-[var(--tblr-primary)] transition-colors" />
          Nouvelle observation
        </button>
      </div>
      <DialogShell
        open={!!reattribution}
        onClose={() => setReattribution(null)}
        busy={reattribution?.busy}
        title={t('observations_reassign')}
        subtitle={(() => { const o = reattribution ? observations.find(x => x.id === reattribution.id) : null; return o ? `#${String(o.number || '').padStart(2, '0')} · ${(o.texte || '').slice(0, 80)}` : undefined; })()}
        footer={reattribution && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setReattribution(null)} disabled={reattribution.busy}>{t('projectdetail_dialog_cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={() => void appliquerReattribution()} disabled={reattribution.busy || reattribution.lotIds.length === 0}>
              {reattribution.mode === 'changer' ? t('observations_reassign_move') : t('observations_reassign_copy', { count: reattribution.lotIds.length })}
            </button>
          </>
        )}
      >
        {reattribution && (() => {
          const source = observations.find(o => o.id === reattribution.id);
          const choix = lots.filter(l => reattribution.mode === 'ajouter' ? l.id !== source?.lot_id : true);
          return (
            <div className="space-y-4">
              <div role="radiogroup" aria-label={t('observations_reassign')} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(['changer', 'ajouter'] as const).map(mode => (
                  <label key={mode} className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${reattribution.mode === mode ? 'border-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)]' : 'border-[var(--tblr-border)]'}`}>
                    <input type="radio" name="reattribution-mode" checked={reattribution.mode === mode} onChange={() => setReattribution({ ...reattribution, mode, lotIds: [] })} className="mt-1" />
                    <span><span className="block font-semibold">{t(`observations_reassign_mode_${mode}`)}</span><span className="block text-xs text-[var(--tblr-muted)]">{t(`observations_reassign_mode_${mode}_hint`)}</span></span>
                  </label>
                ))}
              </div>
              <fieldset className="space-y-1">
                <legend className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{t('observations_reassign_companies')}</legend>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
                  {choix.map(l => {
                    const coche = reattribution.lotIds.includes(l.id);
                    return (
                      <label key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--tblr-surface-2)]">
                        <input type={reattribution.mode === 'changer' ? 'radio' : 'checkbox'} name="reattribution-lot" checked={coche}
                          onChange={() => setReattribution({ ...reattribution, lotIds: reattribution.mode === 'changer' ? [l.id] : coche ? reattribution.lotIds.filter(x => x !== l.id) : [...reattribution.lotIds, l.id] })} />
                        <span className="min-w-0 truncate">{l.lot_number} · {l.lot_title}<span className="text-[var(--tblr-muted)]"> — {l.contact_name || t('observations_reassign_no_company')}</span>{l.id === source?.lot_id ? <span className="text-[var(--tblr-muted)]"> ({t('observations_reassign_current')})</span> : null}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          );
        })()}
      </DialogShell>
      {confirmDialog}
    </div>
  );
}
