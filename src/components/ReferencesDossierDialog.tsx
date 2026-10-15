import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight, IconFileTypePdf, IconLoader2, IconPhotoPlus, IconStar, IconStarFilled, IconX } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { cn } from '../lib/utils';
import type { RefItem } from '../lib/referenceItems';
import { useEscapeKey } from '../hooks/useEscapeKey';

/** Catégorie des images téléversées pour une référence (aussi lue côté serveur). */
const IMAGE_CATEGORY = 'Références - images';
const MAX_IMAGES = 6;

type Source = 'project' | 'manual';
interface Candidate { id: string; label: string; kind: 'cover' | 'document' | 'gallery' }
interface Fields { nature: string; city: string; department: string; labels: string; maitre_oeuvre: string; mission: string; phase: string; amount_text: string }
const EMPTY_FIELDS: Fields = { nature: '', city: '', department: '', labels: '', maitre_oeuvre: '', mission: '', phase: '', amount_text: '' };

interface EntryState {
  loading: boolean;
  candidates: Candidate[];
  fields: Fields;
  defaults: Partial<Record<keyof Fields, string>>;
  imageIds: string[];
  primary: string | null;
  program: string;
  programDefault: string;
  sheetsAvailable: boolean;
  uploading: boolean;
  saving: boolean;
  message: string | null;
}

const EMPTY_STATE: EntryState = {
  loading: true, candidates: [], fields: EMPTY_FIELDS, defaults: {}, imageIds: [], primary: null, program: '', programDefault: '',
  sheetsAvailable: true, uploading: false, saving: false, message: null,
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Vignette lue avec le jeton de la personne (un <img src> ne porterait pas l'authentification). */
function Thumb({ source, id, image }: { source: Source; id: string; image: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/references/dossier/image/${source}/${encodeURIComponent(id)}?image=${encodeURIComponent(image)}`, { headers: await authHeaders() });
        if (!res.ok) return;
        url = URL.createObjectURL(await res.blob());
        if (!cancelled) setSrc(url);
      } catch { /* vignette absente : le cadre reste vide */ }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [source, id, image]);
  return src
    ? <img src={src} alt="" className="w-full h-full object-cover" />
    : <div className="w-full h-full" style={{ background: 'var(--tblr-surface-2)' }} />;
}

interface Props {
  items: RefItem[];
  initialSelectedIds: string[];
  onClose: () => void;
}

export function ReferencesDossierDialog({ items, initialSelectedIds, onClose }: Props) {
  const { t } = useTranslation();
  useEscapeKey(true, onClose);
  const [order, setOrder] = useState<string[]>(() => items.filter(i => initialSelectedIds.includes(i.id)).map(i => i.id));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, EntryState>>({});
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [manager, setManager] = useState('Khaldoun SEKTAOUI');
  const [includeCover, setIncludeCover] = useState(true);
  const [includeList, setIncludeList] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const requested = useRef(new Set<string>());

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const patch = (id: string, p: Partial<EntryState>) => setState(s => ({ ...s, [id]: { ...(s[id] ?? EMPTY_STATE), ...p } }));

  async function loadEntry(item: RefItem, keepSelection = false) {
    const prev = state[item.id];
    try {
      const data = await apiFetch<any>(`/api/references/dossier/sheet/${item.source}/${encodeURIComponent(item.id)}`);
      const candidates: Candidate[] = data.candidates || [];
      const sheet = data.sheet || {};
      const r = data.resolved || {};
      const saved: string[] = (sheet.images || []).map((i: any) => i.id).filter((id: string) => candidates.some(c => c.id === id));
      const imageIds = keepSelection && prev ? prev.imageIds : (saved.length ? saved : candidates.slice(0, 1).map(c => c.id));
      const primary = keepSelection && prev ? prev.primary : ((sheet.images || []).find((i: any) => i.is_primary && imageIds.includes(i.id))?.id ?? imageIds[0] ?? null);
      const programDefault: string = r.programme || '';
      patch(item.id, {
        loading: false, candidates, imageIds, primary, sheetsAvailable: data.sheetsAvailable !== false,
        fields: {
          nature: sheet.nature || '', city: sheet.city || '', department: sheet.department || '', labels: sheet.labels || '',
          maitre_oeuvre: sheet.maitre_oeuvre || '', mission: sheet.mission || '', phase: sheet.phase || '', amount_text: sheet.amount_text || '',
        },
        defaults: { nature: r.nature || '', city: r.city || '', department: r.department || '', maitre_oeuvre: r.maitreOeuvre || '', mission: r.mission || '' },
        program: keepSelection && prev ? prev.program : programDefault, programDefault,
      });
    } catch (e: any) {
      patch(item.id, { loading: false, message: e.message });
    }
  }

  // La fiche d'une référence se charge à sa première ouverture.
  useEffect(() => {
    if (!open || requested.current.has(open)) return;
    const item = byId.get(open);
    if (!item) return;
    requested.current.add(open);
    patch(open, { loading: true });
    void loadEntry(item);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setOrder(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]));
  const move = (id: string, dir: -1 | 1) => setOrder(o => {
    const i = o.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return o;
    const next = [...o]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const toggleImage = (id: string, imageId: string) => {
    const st = state[id]; if (!st) return;
    if (st.imageIds.includes(imageId)) {
      const imageIds = st.imageIds.filter(x => x !== imageId);
      patch(id, { imageIds, primary: st.primary === imageId ? (imageIds[0] ?? null) : st.primary });
    } else if (st.imageIds.length < MAX_IMAGES) {
      patch(id, { imageIds: [...st.imageIds, imageId], primary: st.primary ?? imageId });
    } else {
      patch(id, { message: t('refdossier_max') });
    }
  };

  async function upload(item: RefItem, files: FileList | null) {
    if (!files || files.length === 0) return;
    patch(item.id, { uploading: true, message: null });
    try {
      const headers = await authHeaders();
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('name', file.name);
        form.append('category', IMAGE_CATEGORY);
        if (item.source === 'project') form.append('project_id', item.id);
        else { form.append('resource_type', 'custom_references'); form.append('resource_id', item.id); }
        const res = await fetch('/api/documents', { method: 'POST', headers, body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t('refdossier_upload_error'));
        const doc = await res.json();
        // Les images ajoutées sont retenues d'office, dans la limite de 6.
        setState(s => {
          const cur = s[item.id] ?? EMPTY_STATE;
          return cur.imageIds.length >= MAX_IMAGES ? s : { ...s, [item.id]: { ...cur, imageIds: [...cur.imageIds, `doc:${doc.id}`], primary: cur.primary ?? `doc:${doc.id}` } };
        });
      }
      await loadEntry(item, true);
    } catch (e: any) {
      patch(item.id, { message: e.message || t('refdossier_upload_error') });
    } finally {
      patch(item.id, { uploading: false });
    }
  }

  async function saveSheet(item: RefItem) {
    const st = state[item.id]; if (!st) return;
    patch(item.id, { saving: true, message: null });
    try {
      await apiFetch(`/api/references/dossier/sheet/${item.source}/${encodeURIComponent(item.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...st.fields, imageIds: st.imageIds, primaryImageId: st.primary }),
      });
      patch(item.id, { message: t('refdossier_saved') });
    } catch (e: any) {
      patch(item.id, { message: e.message });
    } finally {
      patch(item.id, { saving: false });
    }
  }

  async function generate() {
    setGenerating(true); setError(null); setWarnings([]);
    try {
      const selections = order.map(id => {
        const item = byId.get(id)!; const st = state[id];
        return {
          source: item.source, id,
          // Sans ouverture de la fiche, le serveur applique les images enregistrées (à défaut la couverture).
          imageIds: st && !st.loading ? st.imageIds : undefined,
          primaryImageId: st?.primary ?? null,
          programOverride: st && st.program.trim() && st.program.trim() !== st.programDefault.trim() ? st.program : null,
        };
      });
      const res = await fetch('/api/references/dossier/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ selections, orientation, manager, includeCover, includeList }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t('refdossier_error'));
      try { setWarnings(JSON.parse(decodeURIComponent(res.headers.get('X-Dossier-Warnings') || '[]'))); } catch { /* en-tête absent */ }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `references-${orientation === 'portrait' ? 'portrait' : 'paysage'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      setError(e.message || t('refdossier_error'));
    } finally {
      setGenerating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => !q || `${i.name} ${i.client}`.toLowerCase().includes(q));
  }, [items, query]);

  const inputCls = 'w-full px-2 py-1.5 rounded text-sm outline-none';
  const inputStyle = { background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
  const fieldKeys: Array<[keyof Fields, string]> = [
    ['nature', 'refdossier_f_nature'], ['city', 'refdossier_f_city'], ['department', 'refdossier_f_department'], ['labels', 'refdossier_f_labels'],
    ['maitre_oeuvre', 'refdossier_f_moe'], ['mission', 'refdossier_f_mission'], ['phase', 'refdossier_f_phase'], ['amount_text', 'refdossier_f_amount'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="refdossier-title">
      <div className="w-full max-w-6xl max-h-[96dvh] flex flex-col rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="flex items-start justify-between gap-4 p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div>
            <h2 id="refdossier-title" className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('refdossier_title')}</h2>
            <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('refdossier_close') as string} className="p-2 rounded hover:bg-[var(--tblr-surface-2)]"><IconX size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[18rem_1fr] overflow-hidden">
          <div className="min-h-0 flex flex-col p-3 gap-2 max-h-48 lg:max-h-none" style={{ borderRight: '1px solid var(--tblr-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_pick')}</p>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('refdossier_search') as string} aria-label={t('refdossier_search') as string} className={inputCls} style={inputStyle} />
            <ul className="flex-1 overflow-auto space-y-0.5">
              {filtered.map(i => (
                <li key={i.id}>
                  <label className="flex items-start gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--tblr-surface-2)] text-sm" style={{ color: 'var(--tblr-text)' }}>
                    <input type="checkbox" className="mt-1" checked={order.includes(i.id)} onChange={() => toggle(i.id)} />
                    <span className="min-w-0"><span className="block truncate">{i.name}</span><span className="block truncate text-xs" style={{ color: 'var(--tblr-muted)' }}>{i.client || '---'}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-h-0 overflow-auto p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_selected', { count: order.length })}</p>
            {order.length === 0 && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_empty')}</p>}
            {order.map((id, idx) => {
              const item = byId.get(id); if (!item) return null;
              const st = state[id] ?? EMPTY_STATE;
              const isOpen = open === id;
              return (
                <div key={id} className="rounded" style={{ border: '1px solid var(--tblr-border)' }}>
                  <div className="flex items-center gap-1 p-2">
                    <button onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm" style={{ color: 'var(--tblr-text)' }}>
                      {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      <span className="tabular-nums w-6 text-xs" style={{ color: 'var(--tblr-muted)' }}>{idx + 1}</span>
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="hidden sm:inline text-xs shrink-0" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_edit')}</span>
                    </button>
                    <button onClick={() => move(id, -1)} disabled={idx === 0} aria-label={`${t('refdossier_move_up')} : ${item.name}`} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)] disabled:opacity-30"><IconArrowUp size={16} /></button>
                    <button onClick={() => move(id, 1)} disabled={idx === order.length - 1} aria-label={`${t('refdossier_move_down')} : ${item.name}`} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)] disabled:opacity-30"><IconArrowDown size={16} /></button>
                    <button onClick={() => toggle(id)} aria-label={`${t('refdossier_remove')} : ${item.name}`} className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]"><IconX size={16} /></button>
                  </div>

                  {isOpen && (
                    <div className="p-3 space-y-4" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                      {st.loading ? <IconLoader2 className="animate-spin" size={18} /> : (
                        <>
                          <div>
                            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_images')}</p>
                            {st.candidates.length === 0 && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_no_images')}</p>}
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                              {st.candidates.map(c => {
                                const picked = st.imageIds.includes(c.id);
                                const rank = st.imageIds.indexOf(c.id) + 1;
                                return (
                                  <div key={c.id} className={cn('relative aspect-[4/3] rounded overflow-hidden')} style={{ border: `2px solid ${picked ? 'var(--tblr-primary)' : 'var(--tblr-border)'}` }}>
                                    <button onClick={() => toggleImage(id, c.id)} aria-pressed={picked} aria-label={`${t('refdossier_use')} : ${c.label}`} className="absolute inset-0 w-full h-full">
                                      <Thumb source={item.source} id={id} image={c.id} />
                                    </button>
                                    {picked && <span className="absolute top-1 left-1 text-[0.6875rem] px-1.5 rounded" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>{rank}</span>}
                                    {picked && (
                                      <button onClick={() => patch(id, { primary: c.id, imageIds: [c.id, ...st.imageIds.filter(x => x !== c.id)] })}
                                        aria-label={`${t('refdossier_primary_set')} : ${c.label}`} title={st.primary === c.id ? t('refdossier_primary') as string : t('refdossier_primary_set') as string}
                                        className="absolute top-1 right-1 p-1 rounded" style={{ background: 'rgba(255,255,255,.9)', color: 'var(--tblr-primary)' }}>
                                        {st.primary === c.id ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <label className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded text-sm cursor-pointer hover:bg-[var(--tblr-surface-2)]" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                              {st.uploading ? <IconLoader2 size={16} className="animate-spin" /> : <IconPhotoPlus size={16} />}
                              {t('refdossier_add_images')}
                              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={st.uploading} onChange={e => { void upload(item, e.target.files); e.target.value = ''; }} />
                            </label>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {fieldKeys.map(([key, label]) => (
                              <div key={key}>
                                <label htmlFor={`rd-${id}-${key}`} className="block text-xs mb-1" style={{ color: 'var(--tblr-muted)' }}>{t(label)}</label>
                                <input id={`rd-${id}-${key}`} className={inputCls} style={inputStyle} value={st.fields[key]} placeholder={st.defaults[key] || 'NC'}
                                  onChange={e => patch(id, { fields: { ...st.fields, [key]: e.target.value } })} />
                              </div>
                            ))}
                          </div>
                          <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_nc_hint')}</p>

                          <div>
                            <label htmlFor={`rd-${id}-prog`} className="block text-xs mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_program')}</label>
                            <textarea id={`rd-${id}-prog`} rows={4} className={inputCls} style={inputStyle} value={st.program} onChange={e => patch(id, { program: e.target.value })} />
                          </div>

                          {!st.sheetsAvailable && <p className="text-xs text-amber-600">{t('refdossier_no_table')}</p>}
                          <div className="flex items-center gap-3">
                            <button onClick={() => saveSheet(item)} disabled={st.saving || !st.sheetsAvailable} className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                              {st.saving ? <IconLoader2 size={14} className="animate-spin inline" /> : t('refdossier_save_sheet')}
                            </button>
                            {st.message && <span role="status" className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{st.message}</span>}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {warnings.length > 0 && (
            <details className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
              <summary>{t('refdossier_warnings')} ({warnings.length})</summary>
              <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="rd-orientation" className="block text-xs mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_orientation')}</label>
              <select id="rd-orientation" value={orientation} onChange={e => setOrientation(e.target.value as 'landscape' | 'portrait')} className={inputCls} style={inputStyle}>
                <option value="landscape">{t('refdossier_landscape')}</option>
                <option value="portrait">{t('refdossier_portrait')}</option>
              </select>
            </div>
            <div className="min-w-48">
              <label htmlFor="rd-manager" className="block text-xs mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('refdossier_manager')}</label>
              <input id="rd-manager" value={manager} onChange={e => setManager(e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--tblr-text)' }}><input type="checkbox" checked={includeCover} onChange={e => setIncludeCover(e.target.checked)} />{t('refdossier_cover')}</label>
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--tblr-text)' }}><input type="checkbox" checked={includeList} onChange={e => setIncludeList(e.target.checked)} />{t('refdossier_list')}</label>
            <button onClick={generate} disabled={generating || order.length === 0} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--tblr-primary)' }}>
              {generating ? <IconLoader2 size={16} className="animate-spin" /> : <IconFileTypePdf size={16} />}
              {generating ? t('refdossier_generating') : t('refdossier_generate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
