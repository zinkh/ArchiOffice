import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  ColumnFiltersState,
  VisibilityState,
} from '@tanstack/react-table';
import { IconPlus, IconTrash, IconColumns, IconChevronDown } from '@tabler/icons-react';
import { Observation, ProjectLot } from '../types';

interface Props {
  projectId: string;
  lots: ProjectLot[];
  reportId?: string;
  currentReportId?: string;
}

const STATUTS = ['À faire', 'En cours', 'Levée', 'Urgent', 'Refusée'] as const;

const statutColors: Record<string, string> = {
  'À faire': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'En cours': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'Levée': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'Urgent': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  'Refusée': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const columnHelper = createColumnHelper<Observation>();

const COLUMN_LABELS: Record<string, string> = {
  number: 'N°',
  lot: 'Lot',
  texte: 'Observation',
  statut: 'Statut',
  due_date: 'Délai',
  created_report_number: 'CR émis',
  resolved_report_number: 'CR levée',
  actions: '',
};

export default function ObservationsTable({ projectId, lots, reportId, currentReportId }: Props) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [lotFilter, setLotFilter] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const endpoint = reportId
    ? `/api/reports/${reportId}/observations`
    : `/api/projects/${projectId}/observations`;

  const fetchObservations = useCallback(() => {
    fetch(endpoint)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setObservations(data); })
      .catch(console.error);
  }, [endpoint]);

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
      fetch(`/api/observations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      }).catch(console.error);
    }, 300);
  }, []);

  const updateLocal = (id: string, patch: Partial<Observation>) => {
    setObservations(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  };

  const addRow = () => {
    fetch(`/api/projects/${projectId}/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte: '', statut: 'À faire', created_report_id: currentReportId || null }),
    })
      .then(r => r.json())
      .then(newObs => setObservations(prev => [...prev, newObs]))
      .catch(console.error);
  };

  const deleteRow = (id: string) => {
    if (!confirm('Supprimer cette observation ?')) return;
    fetch(`/api/observations/${id}`, { method: 'DELETE' })
      .then(() => setObservations(prev => prev.filter(o => o.id !== id)))
      .catch(console.error);
  };

  const filtered = observations.filter(o => {
    if (openOnly && o.statut === 'Levée') return false;
    if (statusFilter && o.statut !== statusFilter) return false;
    if (lotFilter && o.lot_id !== lotFilter) return false;
    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      return (o.texte || '').toLowerCase().includes(q) ||
        (o.lot?.lot_title || '').toLowerCase().includes(q);
    }
    return true;
  });

  const columns = [
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
        return (
          <select
            className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs dark:text-white"
            value={row.lot_id || ''}
            onChange={e => {
              const lot = lots.find(l => l.id === e.target.value);
              updateLocal(row.id, { lot_id: e.target.value, lot: lot ? { id: lot.id, lot_number: lot.lot_number, lot_title: lot.lot_title } : undefined });
              saveField(row.id, 'lot_id', e.target.value);
            }}
          >
            <option value="">—</option>
            {lots.map(l => (
              <option key={l.id} value={l.id}>{l.lot_number} · {l.lot_title}</option>
            ))}
          </select>
        );
      },
    }),
    columnHelper.accessor('texte', {
      header: 'Observation',
      cell: info => {
        const row = info.row.original;
        return (
          <input
            type="text"
            className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm dark:text-white"
            defaultValue={info.getValue() || ''}
            placeholder="Saisir une observation..."
            onBlur={e => {
              updateLocal(row.id, { texte: e.target.value });
              saveField(row.id, 'texte', e.target.value);
            }}
          />
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
            className={`w-full p-1 rounded text-[10px] font-bold uppercase tracking-wider border-none cursor-pointer ${statutColors[val] || ''}`}
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
    columnHelper.accessor('due_date', {
      header: 'Délai',
      size: 130,
      cell: info => {
        const row = info.row.original;
        return (
          <input
            type="date"
            className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs dark:text-white"
            defaultValue={info.getValue() || ''}
            onBlur={e => {
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
    columnHelper.display({
      id: 'actions',
      size: 40,
      cell: info => (
        <button
          onClick={() => deleteRow(info.row.original.id)}
          className="text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 p-1 rounded opacity-0 group-hover/row:opacity-100 transition-all"
        >
          <IconTrash size={15} />
        </button>
      ),
    }),
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: { columnFilters, columnVisibility },
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const allColumnIds = columns
    .map(c => ('accessorKey' in c ? String(c.accessorKey) : (c as any).id))
    .filter(id => id && id !== 'actions' && id !== 'number');

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Rechercher..."
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
        />
        <select
          value={lotFilter}
          onChange={e => setLotFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tous les lots</option>
          {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {l.lot_title}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tous les statuts</option>
          {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} className="rounded" />
          Ouverts seulement
        </label>
        <div className="ml-auto relative" ref={columnMenuRef}>
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
              {allColumnIds.map(colId => {
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

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-xl">
        <table className="w-full text-sm border-collapse">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="p-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map(row => (
                <tr key={row.id} className="group/row hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="p-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
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
          onClick={addRow}
          className="w-full p-3 text-left text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all flex items-center gap-2 text-sm border-t border-zinc-100 dark:border-zinc-700 group"
        >
          <IconPlus size={15} className="text-zinc-400 group-hover:text-blue-500 transition-colors" />
          Nouvelle observation
        </button>
      </div>
    </div>
  );
}
