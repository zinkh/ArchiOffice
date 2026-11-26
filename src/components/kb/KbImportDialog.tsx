// Import de fiches dans la « Base de données » : un CSV, un classeur Excel ou l'export Notion (zip « Markdown et
// CSV »). Trois temps : dépôt du fichier, correspondance des colonnes avec aperçu, import avec progression.
// Le fichier est lu dans le navigateur ; le serveur ne reçoit que des lignes typées, par lots de 500, et valide
// tout (POST /api/kb/databases/:id/import). Avant tout envoi, les lignes sont aussi validées ici par le même
// module que le serveur (planKbImport) : une ligne refusée s'affiche avec son numéro et rien n'est importé.
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconUpload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { KbPage, KbProperty } from '../../lib/kb';
import { decodeCsvBuffer, parseCsv } from '../../lib/csvDecode';
import { kbApi } from '../../lib/kbApi';
import {
  KB_IMPORT_MAX_ROWS, KB_IMPORT_TYPES, buildImportRows, proposeImportColumns, toImportRequests, validateImportColumns,
  type KbImportColumn, type KbImportType,
} from '../../lib/kbImport';
import { planKbImport, type KbImportError } from '../../lib/kbImportPlan';
import { attachNotionPages, notionCsvLabel, readNotionArchive, type NotionArchive } from '../../lib/kbNotionZip';
import { ModalShell } from '../ui/ModalShell';

const MAX_TABLE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const PREVIEW_ROWS = 5;
const SHOWN_ERRORS = 20;

type Step = 'file' | 'map' | 'run' | 'done';

interface Source {
  /** Nom proposé pour une nouvelle base. */
  name: string;
  table: string[][];
  archive: NotionArchive | null;
  csvIndex: number;
}

interface KbImportDialogProps {
  /** Base qui reçoit les fiches ; `null` : une nouvelle base est créée d'après le fichier. */
  database: KbPage | null;
  onClose: () => void;
  /** Import terminé : identifiant de la base (créée ou existante). */
  onDone: (databaseId: string) => void;
}

const NEW_DATABASE_TITLE: KbProperty = { id: 'new-title', database_id: '', name: 'Nom', type: 'title', options: [], position: 0 };

function cellText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '';
  return value === null || value === undefined ? '' : String(value);
}

export function KbImportDialog({ database, onClose, onDone }: KbImportDialogProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('file');
  const [existing, setExisting] = useState<KbProperty[] | null>(database ? null : [NEW_DATABASE_TITLE]);
  const [source, setSource] = useState<Source | null>(null);
  const [columns, setColumns] = useState<KbImportColumn[]>([]);
  const [baseName, setBaseName] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<KbImportError[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState({ created: 0, properties: 0, options: 0, databaseId: '' });

  useEffect(() => {
    if (!database) return;
    let cancelled = false;
    kbApi.properties(database.id).then(list => { if (!cancelled) setExisting(list); }).catch(() => { if (!cancelled) setMessage(t('kb_error_generic') as string); });
    return () => { cancelled = true; };
  }, [database, t]);

  const table = source?.table ?? [];
  const titleColumn = columns.find(c => c.type === 'title');

  // Pages Markdown de l'export Notion rattachées aux fiches (par titre) : comptées ici, converties à l'import.
  const notion = useMemo(() => {
    if (!source?.archive || !titleColumn) return null;
    const rows = table.slice(1).map(row => ({ title: (row[titleColumn.index] ?? '').trim(), cells: {} }));
    const { matched, unmatchedPages } = attachNotionPages(rows, source.archive.pages, table[0] ?? []);
    return { matched, unmatched: unmatchedPages.length };
  }, [source, table, titleColumn]);

  const preview = useMemo(() => (step === 'map' ? buildImportRows(table, columns).slice(0, PREVIEW_ROWS) : []), [step, table, columns]);
  const rowCount = Math.max(0, table.length - 1);

  const loadTable = (next: Source) => {
    setSource(next);
    setColumns(proposeImportColumns(next.table, existing ?? []));
    setBaseName(next.name);
    setErrors([]);
    setMessage(null);
    setStep('map');
  };

  const readFile = async (file: File) => {
    // Les colonnes existantes de la base ne sont pas encore chargées : leurs types ne seraient pas repris.
    if (!existing) return;
    setMessage(null);
    const extension = file.name.toLowerCase().split('.').pop() ?? '';
    const isZip = extension === 'zip';
    if (!['csv', 'tsv', 'txt', 'xlsx', 'xls', 'ods', 'zip'].includes(extension)) { setMessage(t('kb_import_error_type') as string); return; }
    if (file.size > (isZip ? MAX_ARCHIVE_BYTES : MAX_TABLE_BYTES)) {
      setMessage(t('kb_import_error_size', { max: isZip ? '200 Mo' : '20 Mo' }) as string);
      return;
    }
    setReading(true);
    try {
      let rows: string[][];
      let archive: NotionArchive | null = null;
      let name = file.name.replace(/\.[^.]+$/, '');
      if (isZip) {
        archive = await readNotionArchive(file);
        if (archive.csvs.length === 0) { setMessage(t('kb_import_error_zip') as string); return; }
        rows = parseCsv(archive.csvs[0].text);
        name = notionCsvLabel(archive.csvs[0].name) || name;
      } else if (['xlsx', 'xls', 'ods'].includes(extension)) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false, cellHTML: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' }))
          .map(row => row.map(cell => String(cell ?? '')))
          .filter(row => row.some(cell => cell.trim() !== ''));
      } else {
        rows = parseCsv(decodeCsvBuffer(await file.arrayBuffer()).text);
      }
      if (rows.length < 2) { setMessage(t('kb_import_error_empty') as string); return; }
      if (rows.length - 1 > KB_IMPORT_MAX_ROWS) { setMessage(t('kb_import_error_rows', { max: KB_IMPORT_MAX_ROWS }) as string); return; }
      loadTable({ name, table: rows, archive, csvIndex: 0 });
    } catch (e: any) {
      setMessage(e?.message === 'ARCHIVE_UNREADABLE' ? t('kb_import_error_zip') as string : t('kb_import_error_read') as string);
    } finally {
      setReading(false);
    }
  };

  const chooseCsv = (index: number) => {
    const csv = source?.archive?.csvs[index];
    if (!source || !csv) return;
    const rows = parseCsv(csv.text);
    if (rows.length < 2) { setMessage(t('kb_import_error_empty') as string); return; }
    loadTable({ ...source, table: rows, csvIndex: index, name: notionCsvLabel(csv.name) || source.name });
  };

  const patchColumn = (index: number, patch: Partial<KbImportColumn>) => setColumns(prev => prev.map(c => {
    if (c.index === index) return { ...c, ...patch };
    // Un seul titre : choisir une autre colonne comme titre rend l'ancienne colonne titre à du texte.
    if (patch.type === 'title' && c.type === 'title') return { ...c, type: 'text' };
    return c;
  }));

  const start = async () => {
    if (!source) return;
    setMessage(null);
    setErrors([]);
    const invalid = validateImportColumns(columns);
    if (invalid) { setMessage(t(`kb_import_invalid_${invalid}`) as string); return; }

    let rows = buildImportRows(table, columns);
    if (source.archive) rows = attachNotionPages(rows, source.archive.pages, table[0] ?? []).rows;
    if (rows.length === 0) { setMessage(t('kb_import_error_empty') as string); return; }

    // Validation locale, avec la règle du serveur : rien ne part tant qu'une ligne est refusée.
    const requests = toImportRequests(columns, rows);
    const found: KbImportError[] = [];
    requests.forEach((request, chunk) => {
      const plan = planKbImport(request, existing ?? [NEW_DATABASE_TITLE], () => crypto.randomUUID());
      if (plan.fatal) found.push({ row: 0, error: plan.fatal });
      plan.errors.forEach(error => found.push({ ...error, row: error.row + chunk * requests[0].rows.length }));
    });
    if (found.length > 0) { setErrors(found); return; }

    setStep('run');
    setProgress({ done: 0, total: rows.length });
    let databaseId = database?.id ?? '';
    let created = 0;
    let properties = 0;
    let options = 0;
    try {
      if (!databaseId) databaseId = (await kbApi.createPage({ kind: 'database', title: baseName.trim() || source.name || (t('kb_untitled') as string) })).id;
      for (const request of requests) {
        const report = await kbApi.importRows(databaseId, request);
        created += report.created;
        properties += report.properties_created.length;
        options += report.options_created;
        setProgress({ done: created, total: rows.length });
      }
      setResult({ created, properties, options, databaseId });
      setStep('done');
    } catch (e: any) {
      setMessage(t('kb_import_partial', { done: created, error: e?.message || (t('kb_error_generic') as string) }) as string);
      setStep('map');
      // Des fiches sont déjà créées : la base reste utilisable, le parent la rechargera à la fermeture.
      if (databaseId) setResult({ created, properties, options, databaseId });
    }
  };

  const close = () => {
    if (result.databaseId) onDone(result.databaseId);
    else onClose();
  };

  const busy = reading || step === 'run';
  const columnNames = columns.filter(c => c.include).map(c => c.name);
  const otherColumnNames = columnNames.filter(name => name !== titleColumn?.name);

  return (
    <ModalShell
      title={database ? t('kb_import_title') : t('kb_import_title_new')}
      subtitle={source ? `${source.name} · ${t('kb_import_rows_found', { count: rowCount })}` : undefined}
      onClose={close}
      busy={busy}
      dirty={step === 'map' && columns.length > 0 && !result.databaseId}
      size="lg"
      footer={(
        <>
          {step === 'map' && <button type="button" className="btn btn-ghost mr-auto" onClick={() => { setStep('file'); setSource(null); setMessage(null); setErrors([]); }}>{t('kb_import_back')}</button>}
          {step === 'map' && (
            <button type="button" className="btn btn-primary" disabled={columnNames.length === 0} onClick={() => void start()}>
              {t('kb_import_start', { count: rowCount })}
            </button>
          )}
          {(step === 'done' || (step === 'file' && !reading)) && (
            <button type="button" className={step === 'done' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={close}>{step === 'done' ? t('kb_import_close') : t('kb_cancel')}</button>
          )}
        </>
      )}
    >
      <div className="p-4 sm:p-6 space-y-4">
        {message && (
          <p role="alert" className="flex items-start gap-2 text-[0.875rem]" style={{ color: 'var(--tblr-text)' }}>
            <IconAlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" style={{ color: 'var(--tblr-danger)' }} />{message}
          </p>
        )}

        {step === 'file' && (
          <>
            <label
              className="flex flex-col items-center justify-center gap-2 text-center p-8 rounded-lg border-2 border-dashed cursor-pointer focus-within:ring-2 focus-within:ring-[var(--tblr-primary)]"
              style={{ borderColor: dragging ? 'var(--tblr-primary)' : 'var(--tblr-border)', background: dragging ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface-2)' }}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file && existing) void readFile(file); }}
            >
              <IconUpload size={28} aria-hidden style={{ color: 'var(--tblr-muted)' }} />
              <span className="font-medium" style={{ color: 'var(--tblr-text)' }}>{reading ? t('kb_import_reading') : t('kb_import_drop')}</span>
              <span className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_formats')}</span>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.zip"
                disabled={reading || !existing}
                onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file); e.target.value = ''; }}
              />
            </label>
            <p className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_notion_help')}</p>
          </>
        )}

        {step === 'map' && source && (
          <>
            {source.archive && source.archive.csvs.length > 1 && (
              <label className="block">
                <span className="block mb-1 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_csv_choice')}</span>
                <select className="tblr-input w-full" value={source.csvIndex} onChange={e => chooseCsv(Number(e.target.value))}>
                  {source.archive.csvs.map((csv, index) => <option key={csv.name} value={index}>{csv.name}</option>)}
                </select>
              </label>
            )}
            {!database && (
              <label className="block">
                <span className="block mb-1 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_base_name')}</span>
                <input className="tblr-input w-full" value={baseName} maxLength={200} onChange={e => setBaseName(e.target.value)} />
              </label>
            )}
            {notion && (
              <p className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>
                {t('kb_import_pages_matched', { count: notion.matched })}
                {notion.unmatched > 0 && ` ${t('kb_import_pages_unmatched', { count: notion.unmatched })}`}
              </p>
            )}

            <div className="card overflow-x-auto">
              <table className="tblr-table w-full" aria-label={t('kb_import_columns') as string}>
                <thead>
                  <tr>
                    <th scope="col" className="w-10"><span className="sr-only">{t('kb_import_col_include')}</span></th>
                    <th scope="col">{t('kb_import_col_header')}</th>
                    <th scope="col">{t('kb_import_col_name')}</th>
                    <th scope="col">{t('kb_import_col_type')}</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map(column => (
                    <tr key={column.index}>
                      <td>
                        <input
                          type="checkbox"
                          checked={column.include}
                          disabled={column.type === 'title'}
                          aria-label={`${t('kb_import_col_include')} : ${column.header || column.name}`}
                          onChange={e => patchColumn(column.index, { include: e.target.checked })}
                        />
                      </td>
                      <td className="truncate max-w-[12rem]" title={column.header}>{column.header || '—'}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            className="tblr-input w-full min-w-[8rem]"
                            value={column.name}
                            maxLength={80}
                            disabled={!column.include || column.existingId !== null}
                            aria-label={`${t('kb_import_col_name')} : ${column.header || column.name}`}
                            onChange={e => patchColumn(column.index, { name: e.target.value })}
                          />
                          {column.existingId && <span className="tblr-badge shrink-0">{t('kb_import_existing')}</span>}
                        </div>
                      </td>
                      <td>
                        <select
                          className="tblr-input"
                          value={column.type}
                          disabled={!column.include || (column.existingId !== null && column.type !== 'title')}
                          aria-label={`${t('kb_import_col_type')} : ${column.header || column.name}`}
                          onChange={e => patchColumn(column.index, { type: e.target.value as KbImportType })}
                        >
                          {KB_IMPORT_TYPES.map(type => <option key={type} value={type}>{t(`kb_type_${type}`)}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section aria-label={t('kb_import_preview', { count: PREVIEW_ROWS }) as string}>
              <h3 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_preview', { count: PREVIEW_ROWS })}</h3>
              <div className="card overflow-x-auto">
                <table className="tblr-table w-full">
                  <thead>
                    <tr>
                      <th scope="col">{titleColumn?.name || t('kb_untitled')}</th>
                      {otherColumnNames.map(name => <th key={name} scope="col">{name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, index) => (
                      <tr key={index}>
                        <td className="font-medium">{row.title || <span style={{ color: 'var(--tblr-muted)' }}>{t('kb_untitled')}</span>}</td>
                        {otherColumnNames.map(name => <td key={name} className="max-w-[14rem] truncate">{cellText(row.cells[name])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {errors.length > 0 && (
              <section role="alert" aria-label={t('kb_import_errors_title') as string} className="space-y-1">
                <h3 className="flex items-center gap-2 font-semibold" style={{ color: 'var(--tblr-text)' }}>
                  <IconAlertTriangle size={16} aria-hidden style={{ color: 'var(--tblr-danger)' }} />{t('kb_import_errors_title')}
                </h3>
                <ul className="text-[0.8125rem] list-disc pl-5" style={{ color: 'var(--tblr-text)' }}>
                  {errors.slice(0, SHOWN_ERRORS).map((error, index) => (
                    <li key={index}>
                      {error.row > 0
                        ? (error.column ? t('kb_import_error_line', { row: error.row + 1, column: error.column, error: error.error }) : t('kb_import_error_line_nocol', { row: error.row + 1, error: error.error }))
                        : error.error}
                    </li>
                  ))}
                </ul>
                {errors.length > SHOWN_ERRORS && <p className="text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_more_errors', { count: errors.length - SHOWN_ERRORS })}</p>}
              </section>
            )}
          </>
        )}

        {step === 'run' && (
          <div role="status" aria-live="polite" className="py-6 text-center space-y-3">
            <span aria-hidden className="inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: 'var(--tblr-primary)' }} />
            <p style={{ color: 'var(--tblr-text)' }}>{t('kb_import_progress', { done: progress.done, total: progress.total })}</p>
          </div>
        )}

        {step === 'done' && (
          <div role="status" className="py-4 space-y-2">
            <p className="flex items-center gap-2 font-semibold" style={{ color: 'var(--tblr-text)' }}>
              <IconCheck size={18} aria-hidden style={{ color: 'var(--tblr-success)' }} />{t('kb_import_done', { count: result.created })}
            </p>
            {result.properties > 0 && <p className="text-[0.875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_done_columns', { count: result.properties })}</p>}
            {result.options > 0 && <p className="text-[0.875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('kb_import_done_options', { count: result.options })}</p>}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
