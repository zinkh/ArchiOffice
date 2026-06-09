import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { db } from '../db';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import {
  IconChevronRight,
  IconChevronDown,
  IconBriefcase,
  IconSearch,
  IconChevronUp,
  IconCalendar,
  IconFileTypePdf,
  IconFileSpreadsheet,
  IconPlus,
  IconPencil,
  IconTrash,
  IconX,
  IconLoader2,
  IconBookmark,
  IconUpload,
  IconArrowRight,
  IconArrowLeft,
  IconCheck,
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import type { Project } from '../types';
import { MobileAccordionTable } from '../components/MobileAccordionTable';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadImageAsDataUrl } from '../lib/imageUtils';

// ── Unified reference type ─────────────────────────────────────────────────

interface CustomRef {
  id: string;
  name: string;
  client: string;
  category: string;
  end_date: string | null;
  surface: number | null;
  budget: number | null;
  status: string;
  description: string;
  image_url: string | null;
  location: string;
}

interface RefItem {
  id: string;
  name: string;
  client: string;
  category: string;
  end_date: string | null;
  surface: number | null;
  budget: number | null;
  status: string;
  image_url: string | null;
  project_code?: string;
  source: 'project' | 'manual';
}

function toRefItem(p: Project): RefItem {
  return { id: p.id, name: p.name, client: p.client, category: p.category || 'Non classé', end_date: p.end_date || null, surface: (p as any).surface ?? null, budget: p.budget ?? null, status: p.status, image_url: (p as any).image_url ?? null, project_code: (p as any).project_code, source: 'project' };
}

function customToRefItem(r: CustomRef): RefItem {
  return { id: r.id, name: r.name, client: r.client || '', category: r.category || 'Non classé', end_date: r.end_date, surface: r.surface, budget: r.budget, status: r.status, image_url: r.image_url, source: 'manual' };
}

const EMPTY_FORM: Omit<CustomRef, 'id'> = {
  name: '', client: '', category: '', end_date: '', surface: null, budget: null, status: 'Completed', description: '', image_url: '', location: '',
};

// ── Form modal ─────────────────────────────────────────────────────────────

function RefModal({ initial, onSave, onClose }: {
  initial: Partial<CustomRef> | null;
  onSave: (data: Omit<CustomRef, 'id'>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Omit<CustomRef, 'id'>>({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const isEdit = !!(initial as any)?.id;

  const set = (k: keyof typeof form, v: any) => setForm((p: Omit<CustomRef, 'id'>) => ({ ...p, [k]: v }));

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  const inputCls = "w-full text-sm rounded border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const inputStyle = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };
  const labelCls = "block text-xs font-medium mb-1";
  const labelStyle = { color: 'var(--tblr-muted)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: 'var(--tblr-surface)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
          <h2 className="font-semibold text-base" style={{ color: 'var(--tblr-text)' }}>
            {isEdit ? t('references_edit_modal_title') : t('references_add_modal_title')}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--tblr-surface-2)] transition-colors"><IconX size={18} style={{ color: 'var(--tblr-muted)' }} /></button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls} style={labelStyle}>{t('references_field_name')} *</label>
              <input required value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_client')}</label>
              <input value={form.client} onChange={e => set('client', e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_category')}</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} className={inputCls} style={inputStyle} placeholder="Ex: Logements, ERP, Bureaux…" />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_date')}</label>
              <input type="date" value={form.end_date || ''} onChange={e => set('end_date', e.target.value || null)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_status')}</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls} style={inputStyle}>
                <option value="Completed">Livré</option>
                <option value="In Progress">En cours</option>
                <option value="Planning">En projet</option>
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_surface')}</label>
              <input type="number" min="0" value={form.surface ?? ''} onChange={e => set('surface', e.target.value ? Number(e.target.value) : null)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_budget')}</label>
              <input type="number" min="0" value={form.budget ?? ''} onChange={e => set('budget', e.target.value ? Number(e.target.value) : null)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_location')}</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('references_field_image')}</label>
              <input value={form.image_url || ''} onChange={e => set('image_url', e.target.value || null)} className={inputCls} style={inputStyle} placeholder="https://…" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} style={labelStyle}>{t('references_field_description')}</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} className={inputCls} style={inputStyle} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded border transition-colors hover:bg-[var(--tblr-surface-2)]" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
              Annuler
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {saving && <IconLoader2 size={14} className="animate-spin" />}
              {isEdit ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import wizard ──────────────────────────────────────────────────────────

const IMPORT_FIELDS = [
  { key: 'name', required: true },
  { key: 'client' },
  { key: 'category' },
  { key: 'end_date' },
  { key: 'surface' },
  { key: 'budget' },
  { key: 'status' },
  { key: 'location' },
  { key: 'description' },
] as const;

type ImportField = typeof IMPORT_FIELDS[number]['key'];

const FIELD_SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'nom', 'projet', 'project', 'titre', 'title', 'objet', 'label'],
  client: ['client', 'moa', 'maitre', 'maître', 'commanditaire', 'customer', 'owner'],
  category: ['catégorie', 'categorie', 'category', 'type', 'domaine', 'domain', 'usage', 'typology'],
  end_date: ['date', 'fin', 'livraison', 'end_date', 'delivery', 'achèvement', 'achevement', 'year', 'année', 'annee', 'completion'],
  surface: ['surface', 'shon', 'shab', 'spa', 'area', 'm²', 'superficie', 'floor', 'plancher'],
  budget: ['budget', 'montant', 'coût', 'cout', 'cost', 'prix', 'price', 'honoraires', 'amount'],
  status: ['statut', 'status', 'état', 'etat', 'avancement', 'phase', 'stage'],
  location: ['lieu', 'ville', 'location', 'city', 'address', 'adresse', 'commune', 'localisation', 'site'],
  description: ['description', 'détails', 'details', 'notes', 'commentaires', 'comment', 'note'],
};

function autoDetectMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  for (const field of IMPORT_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field.key];
    const match = headers.find(h =>
      synonyms.some(s => h.toLowerCase().trim().replace(/\s+/g, '').includes(s.replace(/\s+/g, '')))
    );
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function rowToRef(row: Record<string, any>, mapping: Partial<Record<ImportField, string>>): Omit<CustomRef, 'id'> {
  const get = (field: ImportField) => {
    const col = mapping[field];
    return col ? (row[col] ?? '') : '';
  };
  const raw = (field: ImportField) => {
    const col = mapping[field];
    return col ? row[col] : undefined;
  };
  return {
    name: String(get('name') || 'Sans titre').trim(),
    client: String(get('client')).trim(),
    category: String(get('category')).trim(),
    end_date: (() => {
      const v = raw('end_date');
      if (!v) return null;
      if (typeof v === 'number' && v > 1000 && v < 3000) return `${v}-01-01`;
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      return null;
    })(),
    surface: (() => { const v = raw('surface'); return v != null && v !== '' ? Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.')) || null : null; })(),
    budget: (() => { const v = raw('budget'); return v != null && v !== '' ? Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.')) || null : null; })(),
    status: (() => {
      const v = String(get('status')).toLowerCase();
      if (v.includes('cours') || v.includes('progress') || v.includes('ongoing')) return 'In Progress';
      if (v.includes('projet') || v.includes('planning') || v.includes('futur')) return 'Planning';
      return 'Completed';
    })(),
    description: String(get('description')).trim(),
    image_url: null,
    location: String(get('location')).trim(),
  };
}

function ImportWizard({ onClose, onImported }: { onClose: () => void; onImported: (items: CustomRef[]) => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  async function parseFile(file: File) {
    setError('');
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = (XLSX.utils.sheet_to_json as (ws: any, opts: any) => Record<string, any>[])(ws, { defval: '' });
      if (raw.length === 0) { setError('Le fichier semble vide ou non reconnu.'); return; }
      const detectedHeaders = Object.keys(raw[0]);
      setHeaders(detectedHeaders);
      setDataRows(raw);
      setMapping(autoDetectMapping(detectedHeaders));
      setStep(2);
    } catch {
      setError('Impossible de lire le fichier. Vérifiez qu\'il s\'agit bien d\'un Excel ou CSV valide.');
    }
  }

  function handleFileDrop(e: { preventDefault(): void; dataTransfer: { files: FileList } }) {
    e.preventDefault();
    setDragging(false);
    const file = (e.dataTransfer.files as FileList)[0];
    if (file) parseFile(file);
  }

  function handleFileInput(e: { target: HTMLInputElement }) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  const previewRows = useMemo(() => dataRows.slice(0, 5).map(r => rowToRef(r, mapping)), [dataRows, mapping, step]);

  async function handleImport() {
    setImporting(true);
    try {
      const items = dataRows.map(r => rowToRef(r, mapping));
      const result = await apiFetch<CustomRef[]>('/api/references/custom/bulk', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      onImported(result);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'import');
    } finally {
      setImporting(false);
    }
  }

  const inputCls = "text-sm rounded border px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const inputStyle = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };

  const FIELD_LABELS: Record<ImportField, string> = {
    name: t('references_field_name'),
    client: t('references_field_client'),
    category: t('references_field_category'),
    end_date: t('references_field_date'),
    surface: t('references_field_surface'),
    budget: t('references_field_budget'),
    status: t('references_field_status'),
    location: t('references_field_location'),
    description: t('references_field_description'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" style={{ background: 'var(--tblr-surface)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
          <div>
            <h2 className="font-semibold text-base" style={{ color: 'var(--tblr-text)' }}>{t('references_import_title')}</h2>
            <div className="flex items-center gap-2 mt-1">
              {([1, 2, 3] as const).map((s, i) => (
                <div key={s} className="flex items-center gap-1.5">
                  {i > 0 && <div className="w-6 h-px" style={{ background: 'var(--tblr-border)' }} />}
                  <div className={cn("flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", step === s ? "bg-blue-600 text-white" : step > s ? "text-green-600" : "")} style={step !== s && step <= s ? { color: 'var(--tblr-muted)' } : {}}>
                    {step > s ? <IconCheck size={10} /> : <span>{s}</span>}
                    <span className="hidden sm:inline">{t(`references_import_step${s}` as any)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-[var(--tblr-surface-2)] transition-colors ml-4"><IconX size={18} style={{ color: 'var(--tblr-muted)' }} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">

          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="space-y-4">
              <div
                className={cn("border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 py-14 px-6 cursor-pointer transition-colors", dragging ? "border-blue-500 bg-blue-50/50" : "")}
                style={{ borderColor: dragging ? '#3b82f6' : 'var(--tblr-border)' }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--tblr-primary-lt)' }}>
                  <IconUpload size={24} style={{ color: 'var(--tblr-primary)' }} />
                </div>
                <div className="text-center">
                  <p className="font-medium text-sm" style={{ color: 'var(--tblr-text)' }}>{t('references_import_drop')}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('references_import_formats')}</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
              </div>
              {error && <p className="text-sm text-red-500 text-center">{error}</p>}
              <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                <p className="font-medium" style={{ color: 'var(--tblr-text)' }}>Conseils pour l'export :</p>
                <p>• <strong>Notion :</strong> Exporter la base de données → CSV</p>
                <p>• <strong>Airtable :</strong> Grille → Download CSV ou Export to Excel</p>
                <p>• <strong>Excel :</strong> Enregistrer sous → .xlsx ou .csv</p>
              </div>
            </div>
          )}

          {/* Step 2: Column mapping */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
                {t('references_import_mapping_hint')}{' '}
                <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{t('references_import_total', { count: dataRows.length })}</span>
              </p>
              <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--tblr-border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>Champ ArchiOffice</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>Colonne dans votre fichier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {IMPORT_FIELDS.map(field => (
                      <tr key={field.key} style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-sm" style={{ color: 'var(--tblr-text)' }}>
                            {FIELD_LABELS[field.key]}
                            {(field as any).required && <span className="text-red-500 ml-0.5">*</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={mapping[field.key] || ''}
                            onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value || undefined }))}
                            className={cn(inputCls, "w-full")}
                            style={inputStyle}
                          >
                            <option value="">{t('references_import_ignore')}</option>
                            {headers.map(h => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
                {t('references_import_preview_title', { count: Math.min(5, dataRows.length) })}{' '}
                — {t('references_import_total', { count: dataRows.length })}
              </p>
              <div className="rounded-lg overflow-hidden border overflow-x-auto" style={{ borderColor: 'var(--tblr-border)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                      {(['name', 'client', 'category', 'end_date', 'surface', 'budget', 'status'] as ImportField[]).map(f => (
                        <th key={f} className="px-3 py-2 text-left font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--tblr-muted)' }}>{FIELD_LABELS[f]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate" style={{ color: 'var(--tblr-text)' }}>{row.name}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: 'var(--tblr-text)' }}>{row.client || '—'}</td>
                        <td className="px-3 py-2 max-w-[100px] truncate" style={{ color: 'var(--tblr-text)' }}>{row.category || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--tblr-text)' }}>{row.end_date || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--tblr-text)' }}>{row.surface ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono" style={{ color: 'var(--tblr-text)' }}>{row.budget != null ? formatCurrency(row.budget) : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--tblr-text)' }}>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-4 border-t gap-3" style={{ borderColor: 'var(--tblr-border)' }}>
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep(s => (s - 1) as any)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded border transition-colors hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
          >
            {step > 1 && <IconArrowLeft size={14} />}
            {step === 1 ? 'Annuler' : t('references_import_back')}
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={step === 1}
              onClick={() => setStep(s => (s + 1) as any)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {t('references_import_next')}
              <IconArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              disabled={importing || !mapping.name}
              onClick={handleImport}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {importing && <IconLoader2 size={14} className="animate-spin" />}
              {t('references_import_confirm', { count: dataRows.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

interface GroupedRefs { [domain: string]: RefItem[] }

export default function References() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RefItem[]>([]);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<{ key: keyof RefItem; direction: 'asc' | 'desc' } | null>(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [modal, setModal] = useState<{ open: boolean; item: Partial<CustomRef> | null }>({ open: false, item: null });
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const localProjects = await db.projects.toArray();
        if (localProjects.length > 0) {
          setItems(localProjects.map(toRefItem));
          setIsLoading(false);
        }
        if (navigator.onLine) {
          const [projects, customs] = await Promise.all([
            apiFetch<Project[]>('/api/projects'),
            apiFetch<CustomRef[]>('/api/references/custom'),
          ]);
          await db.projects.clear();
          await db.projects.bulkPut(projects);
          setItems([...projects.map(toRefItem), ...customs.map(customToRefItem)]);
        }
      } catch (err) {
        console.error('Failed to fetch references:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (dateFilter === 'all') return true;
      if (!p.end_date) return false;
      const d = new Date(p.end_date);
      const now = new Date();
      if (dateFilter === 'last_year') { const y = new Date(); y.setFullYear(now.getFullYear() - 1); return d >= y; }
      if (dateFilter === 'last_3_years') { const y = new Date(); y.setFullYear(now.getFullYear() - 3); return d >= y; }
      if (dateFilter === 'last_5_years') { const y = new Date(); y.setFullYear(now.getFullYear() - 5); return d >= y; }
      if (dateFilter === 'last_10_years') { const y = new Date(); y.setFullYear(now.getFullYear() - 10); return d >= y; }
      if (dateFilter === 'custom') {
        const start = customDateRange.start ? new Date(customDateRange.start) : null;
        const end = customDateRange.end ? new Date(customDateRange.end) : null;
        if (start && d < start) return false;
        if (end && d > end) return false;
      }
      return true;
    }).sort((a, b) => {
      if (!sortConfig) return 0;
      const av = a[sortConfig.key] ?? '';
      const bv = b[sortConfig.key] ?? '';
      if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
      if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, searchQuery, sortConfig, dateFilter, customDateRange]);

  const groupedItems = useMemo(() => {
    const g: GroupedRefs = {};
    filteredItems.forEach(p => {
      const d = p.category || 'Non classé';
      if (!g[d]) g[d] = [];
      g[d].push(p);
    });
    return g;
  }, [filteredItems]);

  const domains = useMemo(() => Object.keys(groupedItems).sort(), [groupedItems]);

  const toggleDomain = (d: string) => {
    const n = new Set(expandedDomains);
    n.has(d) ? n.delete(d) : n.add(d);
    setExpandedDomains(n);
  };

  const toggleSelectAll = (domain: string) => {
    const dp = groupedItems[domain];
    const allSel = dp.every(p => selectedIds.has(p.id));
    const n = new Set(selectedIds);
    dp.forEach(p => allSel ? n.delete(p.id) : n.add(p.id));
    setSelectedIds(n);
  };

  const toggleSelect = (id: string) => {
    const n = new Set(selectedIds);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelectedIds(n);
  };

  const requestSort = (key: keyof RefItem) => {
    if (sortConfig?.key === key) {
      if (sortConfig.direction === 'asc') { setSortConfig({ key, direction: 'desc' }); return; }
      setSortConfig(null); return;
    }
    setSortConfig({ key, direction: 'asc' });
  };

  const getSortIcon = (key: keyof RefItem) => {
    if (!sortConfig || sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />;
  };

  async function handleSaveRef(data: Omit<CustomRef, 'id'>) {
    const id = (modal.item as any)?.id;
    if (id) {
      const updated = await apiFetch<CustomRef>(`/api/references/custom/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      setItems(prev => prev.map(i => i.id === id ? customToRefItem(updated) : i));
    } else {
      const created = await apiFetch<CustomRef>('/api/references/custom', { method: 'POST', body: JSON.stringify(data) });
      setItems(prev => [...prev, customToRefItem(created)]);
    }
    setModal({ open: false, item: null });
  }

  async function handleDelete(item: RefItem) {
    if (!confirm(t('references_delete_confirm'))) return;
    await apiFetch(`/api/references/custom/${item.id}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== item.id));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
  }

  function openEdit(item: RefItem) {
    setModal({ open: true, item: { id: item.id, name: item.name, client: item.client, category: item.category, end_date: item.end_date, surface: item.surface, budget: item.budget, status: item.status, image_url: item.image_url } as any });
  }

  function handleImported(imported: CustomRef[]) {
    setItems(prev => [...prev, ...imported.map(customToRefItem)]);
  }

  const exportToPDF = async () => {
    const selected = filteredItems.filter(p => selectedIds.has(p.id));
    const doc = new jsPDF();
    let startY = 20;
    try {
      const s = await apiFetch<any>('/api/settings');
      if (s?.logoUrl) { try { const d = await loadImageAsDataUrl(s.logoUrl); doc.addImage(d, 'PNG', 14, 8, 30, 12); startY = 28; } catch { /* skip */ } }
      const txt = s?.agencyName || 'Références';
      doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text(txt, s?.logoUrl ? 48 : 14, 15);
      if (s?.agencyName) { doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text('Références', s.logoUrl ? 48 : 14, 21); }
    } catch { doc.text('Références', 14, 15); }
    autoTable(doc, {
      head: [['Projet', 'Client', 'Date', 'Surface', 'Budget', 'Statut']],
      body: selected.map(p => [p.name, p.client, p.end_date ? new Date(p.end_date).toLocaleDateString() : '---', p.surface ? `${p.surface} m²` : '---', formatCurrency(p.budget ?? 0), p.status]),
      startY,
    });
    doc.save('references.pdf');
  };

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const selected = filteredItems.filter(p => selectedIds.has(p.id));
    let agencyName = '';
    try { const s = await apiFetch<any>('/api/settings'); agencyName = s?.agencyName || ''; } catch { /* */ }
    const rows = selected.map(p => ({ Projet: p.name, Client: p.client, 'Date de livraison': p.end_date ? new Date(p.end_date).toLocaleDateString() : '---', Surface: p.surface ? `${p.surface} m²` : '---', Budget: formatCurrency(p.budget ?? 0), Statut: p.status }));
    const ws = XLSX.utils.json_to_sheet([]);
    if (agencyName) { XLSX.utils.sheet_add_aoa(ws, [[agencyName]], { origin: 'A1' }); XLSX.utils.sheet_add_aoa(ws, [['Références']], { origin: 'A2' }); XLSX.utils.sheet_add_json(ws, rows, { origin: 'A4' }); }
    else { XLSX.utils.sheet_add_json(ws, rows, { origin: 'A1' }); }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Références');
    XLSX.writeFile(wb, 'references.xlsx');
  };

  // ── Status badge ───────────────────────────────────────────────────────────
  function StatusBadge({ status }: { status: string }) {
    const style = status === 'In Progress'
      ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
      : status === 'Completed'
        ? { background: '#d3f9d8', color: '#2f9e44' }
        : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' };
    return <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={style}>{status}</span>;
  }

  // ── Row renderer (shared between grouped and flat views) ───────────────────
  function RefRow({ item }: { item: RefItem }) {
    return (
      <tr
        className="transition-colors"
        style={{ borderBottom: '1px solid var(--tblr-border)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <td className="px-4 py-3">
          <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="w-4 h-4 rounded" />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded overflow-hidden shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
              <img src={item.image_url || `https://picsum.photos/seed/${item.id}/100/100`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{item.name}</p>
                {item.source === 'manual' && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                    <IconBookmark size={9} />{t('references_source_manual')}
                  </span>
                )}
              </div>
              {item.project_code && <p className="text-[10px] font-mono" style={{ color: 'var(--tblr-muted)' }}>#{item.project_code}</p>}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{item.client || '---'}</td>
        <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{item.end_date ? new Date(item.end_date).toLocaleDateString('fr-FR') : '---'}</td>
        <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{item.surface ? `${item.surface} m²` : '---'}</td>
        <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--tblr-text)' }}>{formatCurrency(item.budget ?? 0)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            {item.source === 'manual' && (
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(item)} className="p-1 rounded hover:bg-[var(--tblr-surface-2)] transition-colors" title="Modifier"><IconPencil size={13} style={{ color: 'var(--tblr-muted)' }} /></button>
                <button onClick={() => handleDelete(item)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Supprimer"><IconTrash size={13} className="text-red-500" /></button>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('references_title')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('references_subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <IconPlus size={16} />
            {t('references_add')}
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium border transition-colors shadow-sm hover:bg-[var(--tblr-surface-2)]"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
          >
            <IconUpload size={16} />
            {t('references_import')}
          </button>
          <button onClick={exportToPDF} disabled={selectedIds.size === 0} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            <IconFileTypePdf size={18} />
            {t('references_export_pdf', { count: selectedIds.size })}
          </button>
          <button onClick={exportToExcel} disabled={selectedIds.size === 0} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            <IconFileSpreadsheet size={18} />
            {t('references_export_excel', { count: selectedIds.size })}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 p-4 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <div className="relative flex-1 w-full">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder={t('references_search_placeholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
            style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
            <IconCalendar size={16} style={{ color: 'var(--tblr-muted)' }} />
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="bg-transparent text-sm outline-none cursor-pointer" style={{ color: 'var(--tblr-text)' }}>
              <option value="all">{t('references_all_dates')}</option>
              <option value="last_year">{t('references_last_year')}</option>
              <option value="last_3_years">{t('references_last_3_years')}</option>
              <option value="last_5_years">{t('references_last_5_years')}</option>
              <option value="last_10_years">{t('references_last_10_years')}</option>
              <option value="custom">{t('references_custom_range')}</option>
            </select>
          </div>
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customDateRange.start} onChange={e => setCustomDateRange(p => ({ ...p, start: e.target.value }))} className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
              <span className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('references_date_separator')}</span>
              <input type="date" value={customDateRange.end} onChange={e => setCustomDateRange(p => ({ ...p, end: e.target.value }))} className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        {/* Mobile */}
        <div className="md:hidden">
          <MobileAccordionTable
            data={filteredItems}
            keyField="id"
            emptyText={t('references_no_projects')}
            columns={[
              { label: t('references_col_project'), primary: true, render: (p: RefItem) => (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded overflow-hidden shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                    <img src={p.image_url || `https://picsum.photos/seed/${p.id}/60/60`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    {p.source === 'manual' && <span className="text-[9px] font-semibold" style={{ color: 'var(--tblr-primary)' }}>{t('references_source_manual')}</span>}
                  </div>
                </div>
              )},
              { label: t('references_col_client'), render: (p: RefItem) => p.client || '---' },
              { label: t('references_col_delivery'), render: (p: RefItem) => p.end_date ? new Date(p.end_date).toLocaleDateString('fr-FR') : '---' },
              { label: t('references_col_surface'), render: (p: RefItem) => p.surface ? `${p.surface} m²` : '---' },
              { label: t('references_col_budget'), render: (p: RefItem) => <span className="font-mono">{formatCurrency(p.budget ?? 0)}</span> },
              { label: t('references_col_status'), render: (p: RefItem) => <StatusBadge status={p.status} /> },
            ]}
          />
        </div>

        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
                <th className="w-12 px-4 py-3" />
                {(['name', 'client', 'end_date', 'surface', 'budget', 'status'] as (keyof RefItem)[]).map(col => {
                  const labels: Record<string, string> = { name: t('references_col_project'), client: t('references_col_client'), end_date: t('references_col_delivery'), surface: t('references_col_surface'), budget: t('references_col_budget'), status: t('references_col_status') };
                  return (
                    <th key={col} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors" style={{ color: 'var(--tblr-muted)' }} onClick={() => requestSort(col)} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <div className="flex items-center gap-1">{labels[col]} {getSortIcon(col)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {!sortConfig ? (
                domains.map(domain => {
                  const dp = groupedItems[domain];
                  const isExpanded = expandedDomains.has(domain);
                  const allSel = dp.every(p => selectedIds.has(p.id));
                  const someSel = dp.some(p => selectedIds.has(p.id)) && !allSel;
                  return (
                    <Fragment key={domain}>
                      <tr className="cursor-pointer transition-colors" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }} onClick={() => toggleDomain(domain)} onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-border)')} onMouseLeave={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = someSel; }} onChange={() => toggleSelectAll(domain)} className="w-4 h-4 rounded" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <IconChevronDown size={16} style={{ color: 'var(--tblr-muted)' }} /> : <IconChevronRight size={16} style={{ color: 'var(--tblr-muted)' }} />}
                            <span className="font-semibold uppercase text-xs tracking-wider" style={{ color: 'var(--tblr-text)' }}>{domain}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>{dp.length}</span>
                          </div>
                        </td>
                        <td colSpan={5} />
                      </tr>
                      <AnimatePresence initial={false}>
                        {isExpanded && dp.map(item => (
                          <motion.tr
                            key={item.id}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="transition-colors group"
                            style={{ borderBottom: '1px solid var(--tblr-border)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                          >
                            <td className="px-4 py-3 pl-8">
                              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="w-4 h-4 rounded" />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded overflow-hidden shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                                  <img src={item.image_url || `https://picsum.photos/seed/${item.id}/100/100`} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{item.name}</p>
                                    {item.source === 'manual' && (
                                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>
                                        <IconBookmark size={9} />{t('references_source_manual')}
                                      </span>
                                    )}
                                  </div>
                                  {item.project_code && <p className="text-[10px] font-mono" style={{ color: 'var(--tblr-muted)' }}>#{item.project_code}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{item.client || '---'}</td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{item.end_date ? new Date(item.end_date).toLocaleDateString('fr-FR') : '---'}</td>
                            <td className="px-4 py-3 text-sm" style={{ color: 'var(--tblr-text)' }}>{item.surface ? `${item.surface} m²` : '---'}</td>
                            <td className="px-4 py-3 text-sm font-mono" style={{ color: 'var(--tblr-text)' }}>{formatCurrency(item.budget ?? 0)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <StatusBadge status={item.status} />
                                {item.source === 'manual' && (
                                  <>
                                    <button onClick={() => openEdit(item)} className="p-1 rounded hover:bg-[var(--tblr-surface-2)] transition-colors" title="Modifier"><IconPencil size={13} style={{ color: 'var(--tblr-muted)' }} /></button>
                                    <button onClick={() => handleDelete(item)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Supprimer"><IconTrash size={13} className="text-red-500" /></button>
                                  </>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </Fragment>
                  );
                })
              ) : (
                filteredItems.map(item => <RefRow key={item.id} item={item} />)
              )}
              {domains.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center" style={{ color: 'var(--tblr-muted)' }}>
                    <div className="flex flex-col items-center gap-2">
                      <IconBriefcase size={48} className="opacity-20" />
                      <p>{t('references_no_projects')}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form modal */}
      {modal.open && (
        <RefModal
          initial={modal.item}
          onSave={handleSaveRef}
          onClose={() => setModal({ open: false, item: null })}
        />
      )}

      {/* Import wizard */}
      {importOpen && (
        <ImportWizard
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
