import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Select from 'react-select';
import {
  IconX, IconCamera, IconPhotoPlus, IconTrash, IconDeviceFloppy, IconMapPin, IconLoader2,
} from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { SignedImage } from '../SignedImage';
import type { Plan, ReservePhoto } from '../../types';
import {
  type ReserveLike, type ReserveStatus, RESERVE_STATUSES, StatusSelect, PlanExcerpt,
  parseJsonList, reserveOverdueDays,
} from './reserveShared';

export interface LotOption { id: string; lot_title: string; contact_id?: string; contact_name?: string }

interface ReserveDetailProps {
  apiBase: '/api/reserves' | '/api/gpa-reserves';
  projectId: string;
  /** null : création d'une nouvelle réserve. */
  reserve: ReserveLike | null;
  plans: Plan[];
  lotsList?: LotOption[];
  /** Position choisie sur le plan avant la création (mode création seulement). */
  pendingPlan?: { planId: string | null; x?: number; y?: number } | null;
  onClose: () => void;
  onSaved: (reserve: ReserveLike) => void;
  onDeleted: (id: string) => void;
}

interface FormState {
  title: string;
  description: string;
  status: ReserveStatus;
  batiment: string;
  local: string;
  lots: string[];
  entreprises: string[];
  created_at: string;
  due_date: string;
}

const today = () => new Date().toISOString().split('T')[0];
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso || today());
  return new Date(d.getTime() + days * 86400000).toISOString().split('T')[0];
};

function formFromReserve(r: ReserveLike | null): FormState {
  return {
    title: r?.title || '',
    description: r?.description || '',
    status: r?.status || 'A faire',
    batiment: r?.batiment || '',
    local: r?.local || '',
    lots: parseJsonList(r?.lots),
    entreprises: parseJsonList(r?.entreprises),
    created_at: (r?.created_at || today()).split('T')[0],
    due_date: (r?.due_date || plusDays(today(), 15)).split('T')[0],
  };
}

const inputClass = 'w-full bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500';
const labelClass = 'text-[10px] font-bold text-[var(--tblr-muted)] uppercase tracking-wider';

/**
 * La fiche d'une réserve — création ou modification — en panneau plein
 * écran sur mobile (là où l'on s'en sert sur le chantier) et en modale au
 * bureau. C'est ici qu'on prend une photo : `<input capture="environment">`
 * ouvre directement l'appareil photo sur un téléphone, et la galerie ailleurs.
 *
 * En création, les photos prises avant l'enregistrement sont gardées en file
 * puis envoyées une à une une fois la réserve créée (il faut son id pour les
 * rattacher) ; en modification, chaque photo part immédiatement.
 */
export function ReserveDetail({ apiBase, projectId, reserve, plans, lotsList, pendingPlan, onClose, onSaved, onDeleted }: ReserveDetailProps) {
  const { t } = useTranslation();
  const isNew = !reserve;
  const [form, setForm] = useState<FormState>(() => formFromReserve(reserve));
  const [photos, setPhotos] = useState<ReservePhoto[]>(reserve?.photos || []);
  const [queued, setQueued] = useState<{ file: File; preview: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setForm(formFromReserve(reserve)); setPhotos(reserve?.photos || []); }, [reserve?.id]);
  useEffect(() => () => { queued.forEach(q => URL.revokeObjectURL(q.preview)); }, []);

  const planId = isNew ? pendingPlan?.planId || null : reserve?.plan_id || null;
  const planX = isNew ? pendingPlan?.x : reserve?.x ?? undefined;
  const planY = isNew ? pendingPlan?.y : reserve?.y ?? undefined;
  const plan = useMemo(() => plans.find(p => p.id === planId) || null, [plans, planId]);

  const lotOptions = useMemo(() => (lotsList || []).map(l => ({ value: l.lot_title, label: l.lot_title })), [lotsList]);
  const entrepriseOptions = useMemo(() => {
    const seen = new Set<string>();
    return (lotsList || []).filter(l => l.contact_name && !seen.has(l.contact_name) && seen.add(l.contact_name))
      .map(l => ({ value: l.contact_name as string, label: l.contact_name as string }));
  }, [lotsList]);
  // Une valeur déjà enregistrée qui ne figure plus dans les lots du projet
  // reste sélectionnable : la retirer silencieusement perdrait une donnée.
  const withCurrent = (options: { value: string; label: string }[], current: string[]) => [
    ...options,
    ...current.filter(v => !options.some(o => o.value === v)).map(v => ({ value: v, label: v })),
  ];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const uploadOne = async (reserveId: string, file: File): Promise<ReservePhoto | null> => {
    const body = new FormData();
    body.append('file', file, file.name || 'photo.jpg');
    const res = await fetch(`${apiBase}/${reserveId}/photos`, { method: 'POST', body });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Envoi de la photo refusé (${res.status})`);
    }
    return res.json();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (isNew) {
      setQueued(prev => [...prev, ...list.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
      return;
    }
    setUploading(true); setError(null);
    try {
      for (const file of list) {
        const photo = await uploadOne(reserve!.id, file);
        if (photo) setPhotos(prev => [...prev, photo]);
      }
    } catch (err: any) {
      setError(err.message || 'Envoi impossible.');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (photo: ReservePhoto) => {
    if (!reserve) return;
    if (!confirm(t('reserve_detail_confirm_delete_photo'))) return;
    const res = await fetch(`${apiBase}/${reserve.id}/photos/${photo.id}`, { method: 'DELETE' });
    if (res.ok) setPhotos(prev => prev.filter(p => p.id !== photo.id));
  };

  const removeQueued = (index: number) => setQueued(prev => {
    URL.revokeObjectURL(prev[index].preview);
    return prev.filter((_, i) => i !== index);
  });

  const handleSave = async () => {
    if (!form.title.trim()) { setError("L'intitulé est obligatoire."); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        ...(reserve || {}),
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        batiment: form.batiment,
        local: form.local,
        lots: JSON.stringify(form.lots),
        entreprises: JSON.stringify(form.entreprises),
        created_at: form.created_at,
        due_date: form.due_date,
        plan_id: planId,
        x: planX ?? null,
        y: planY ?? null,
      };
      let saved: ReserveLike;
      if (isNew) {
        const res = await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: window.crypto.randomUUID() }),
        });
        if (!res.ok) throw new Error('Création impossible.');
        saved = await res.json();
        const uploaded: ReservePhoto[] = [];
        for (const q of queued) {
          try {
            const photo = await uploadOne(saved.id, q.file);
            if (photo) uploaded.push(photo);
          } catch (err) {
            console.error('[ReserveDetail] photo non envoyée', err);
          }
        }
        saved = { ...saved, photos: uploaded };
      } else {
        const res = await fetch(`${apiBase}/${reserve!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Enregistrement impossible.');
        saved = { ...(reserve as ReserveLike), ...payload, photos } as ReserveLike;
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!reserve) return;
    if (!confirm(t('reserve_detail_confirm_delete_reserve', { number: reserve.number ?? '' }))) return;
    const res = await fetch(`${apiBase}/${reserve.id}`, { method: 'DELETE' });
    if (res.ok) { onDeleted(reserve.id); onClose(); }
  };

  const retard = reserve ? reserveOverdueDays({ status: form.status, due_date: form.due_date }) : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-2xl h-[94vh] sm:h-auto sm:max-h-[92vh] rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--tblr-surface)' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* En-tête */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--tblr-border)] shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">
              {isNew ? 'Nouvelle réserve' : `Réserve N° ${reserve?.number ?? '-'}`}
            </div>
            <div className="font-bold text-[var(--tblr-text)] truncate">{form.title || (isNew ? '' : reserve?.title)}</div>
          </div>
          <StatusSelect value={form.status} onChange={s => set('status', s)} />
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]" aria-label="Fermer">
            <IconX size={18} />
          </button>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {error && <div className="text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</div>}

          <div className="space-y-1">
            <label className={labelClass}>Intitulé</label>
            <input type="text" className={inputClass} value={form.title} onChange={e => set('title', e.target.value)} placeholder="ex : Peinture à reprendre" autoFocus={isNew} />
          </div>

          {/* Photos : le geste principal sur le chantier, donc en haut de la fiche */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Photos ({photos.length + queued.length})</label>
              {uploading && <span className="flex items-center gap-1 text-[10px] text-[var(--tblr-muted)]"><IconLoader2 size={12} className="animate-spin" /> Envoi…</span>}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="aspect-square rounded-lg border-2 border-dashed border-[var(--tblr-border)] flex flex-col items-center justify-center gap-1 text-[var(--tblr-muted)] hover:border-blue-500 hover:text-blue-600 transition-colors"
              >
                <IconCamera size={24} />
                <span className="text-[10px] font-bold">Prendre une photo</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="aspect-square rounded-lg border-2 border-dashed border-[var(--tblr-border)] flex flex-col items-center justify-center gap-1 text-[var(--tblr-muted)] hover:border-blue-500 hover:text-blue-600 transition-colors"
              >
                <IconPhotoPlus size={24} />
                <span className="text-[10px] font-bold">Depuis la galerie</span>
              </button>
              {photos.map(photo => (
                <div key={photo.id} className="relative aspect-square group">
                  <SignedImage src={photo.file_url} alt={photo.caption || 'Photo de la réserve'} className="w-full h-full object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={() => removePhoto(photo)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-80 hover:opacity-100"
                    aria-label="Supprimer la photo"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              ))}
              {queued.map((q, i) => (
                <div key={q.preview} className="relative aspect-square">
                  <img src={q.preview} alt="Photo à envoyer" className="w-full h-full object-cover rounded-lg opacity-90" />
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-bold">À envoyer</span>
                  <button type="button" onClick={() => removeQueued(i)} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white" aria-label="Retirer la photo">
                    <IconX size={12} />
                  </button>
                </div>
              ))}
            </div>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
            <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {/* Extrait de plan */}
          {plan && planX != null && planY != null ? (
            <div className="space-y-1">
              <label className={labelClass}>Repérage sur le plan</label>
              <div className="flex gap-3 items-start">
                <PlanExcerpt fileUrl={plan.file_url} x={planX} y={planY} label={String(reserve?.number ?? '+')} className="w-40 h-40 object-cover shrink-0" />
                <div className="text-xs text-[var(--tblr-muted)] flex items-center gap-1 pt-1"><IconMapPin size={14} /> {plan.name}</div>
              </div>
            </div>
          ) : plan ? (
            <div className="text-xs text-[var(--tblr-muted)] flex items-center gap-1"><IconMapPin size={14} /> Plan : {plan.name} (sans position)</div>
          ) : null}

          <div className="space-y-1">
            <label className={labelClass}>Commentaire</label>
            <textarea className={cn(inputClass, 'min-h-[72px]')} value={form.description} onChange={e => set('description', e.target.value)} placeholder="État constaté, ce qui reste à faire…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelClass}>Bâtiment</label>
              <input type="text" className={inputClass} value={form.batiment} onChange={e => set('batiment', e.target.value)} placeholder="ex : Bâtiment A" />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Local</label>
              <input type="text" className={inputClass} value={form.local} onChange={e => set('local', e.target.value)} placeholder="ex : Salle 12" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelClass}>Lots</label>
              <Select
                isMulti
                options={withCurrent(lotOptions, form.lots)}
                value={form.lots.map(v => ({ value: v, label: v }))}
                onChange={(vals: any) => set('lots', (vals || []).map((v: any) => v.value))}
                placeholder="Choisir…"
                className="text-sm"
                menuPortalTarget={document.body}
                styles={{ menuPortal: base => ({ ...base, zIndex: 200 }) }}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>En charge (entreprises)</label>
              <Select
                isMulti
                options={withCurrent(entrepriseOptions, form.entreprises)}
                value={form.entreprises.map(v => ({ value: v, label: v }))}
                onChange={(vals: any) => set('entreprises', (vals || []).map((v: any) => v.value))}
                placeholder="Choisir…"
                className="text-sm"
                menuPortalTarget={document.body}
                styles={{ menuPortal: base => ({ ...base, zIndex: 200 }) }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelClass}>Créée le</label>
              <input
                type="date" className={inputClass} value={form.created_at}
                onChange={e => setForm(prev => ({ ...prev, created_at: e.target.value, due_date: isNew ? plusDays(e.target.value, 15) : prev.due_date }))}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Échéance {retard > 0 && <span className="text-red-600">(+{retard} j)</span>}</label>
              <input type="date" className={inputClass} value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </div>
          </div>

          <div className="space-y-1 sm:hidden">
            <label className={labelClass}>Statut</label>
            <select className={inputClass} value={form.status} onChange={e => set('status', e.target.value as ReserveStatus)}>
              {RESERVE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Pied */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--tblr-border)] shrink-0" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {!isNew && (
            <button type="button" onClick={handleDelete} className="p-2.5 rounded-lg text-[var(--tblr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Supprimer la réserve" aria-label="Supprimer la réserve">
              <IconTrash size={18} />
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm font-bold text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">Annuler</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {saving ? <IconLoader2 size={16} className="animate-spin" /> : <IconDeviceFloppy size={16} />}
            {isNew ? 'Créer la réserve' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReserveDetail;
