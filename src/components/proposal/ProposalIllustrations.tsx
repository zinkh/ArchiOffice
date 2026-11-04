// Plan et photos d'une proposition : l'architecte insère un extrait de carte IGN et des
// photos, comme dans une rubrique de l'étude de faisabilité (mêmes boîtes de dialogue :
// FeasibilityMapDialog et FeasibilityPhotoDialog). Les images sont ensuite imprimées par la
// section « Plan et photos » de l'export PDF, activable dans l'éditeur de modèle.
// Les images sont des documents de la proposition ; la liste est enregistrée tout de suite
// (PUT /api/proposals/:id/illustrations), sans attendre l'enregistrement du formulaire.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMap2, IconPhoto, IconLoader2, IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { getAccessToken } from '../../lib/authToken';
import { PHOTO_MAX_INPUT_BYTES, photoLabel, photoToJpeg } from '../../lib/feasibilityPhoto';
import type { FeasibilitySiteData } from '../../lib/feasibilityBlocks';
import { MAX_PROPOSAL_ILLUSTRATIONS, type ProposalIllustration } from '../../lib/proposalIllustrations';
import { SignedImage } from '../SignedImage';
import { FeasibilityMapDialog } from './FeasibilityMapDialog';
import { FeasibilityPhotoDialog, type PhotoWithCaption } from './FeasibilityPhotoDialog';

const inputStyle: React.CSSProperties = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
const softButton: React.CSSProperties = { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' };

interface Props {
  proposalId: string;
  /** Images actuelles de la proposition, dans l'ordre d'ajout. */
  value: ProposalIllustration[];
  /** Appelé à chaque changement de la liste (l'enregistrement est fait ici). */
  onChange: (next: ProposalIllustration[]) => void;
  parcelGeometry?: GeoJSON.Geometry | null;
}

export function ProposalIllustrations({ proposalId, value, onChange, parcelGeometry }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [site, setSite] = useState<FeasibilitySiteData | null>(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<File[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  // Dernière liste connue : les envois de photos sont asynchrones, la liste a pu changer entre-temps.
  const valueRef = useRef(value);
  valueRef.current = value;

  const persist = async (next: ProposalIllustration[]) => {
    valueRef.current = next;
    onChange(next);
    try {
      await apiFetch(`/api/proposals/${proposalId}/illustrations`, { method: 'PUT', body: JSON.stringify({ illustrations: next }) });
    } catch (err: any) {
      setError(err?.message || t('feas_error_generic'));
    }
  };

  const openMap = async () => {
    setNotice(null);
    setError(null);
    let data = site;
    if (!data) {
      setSiteLoading(true);
      try {
        data = await apiFetch<FeasibilitySiteData>(`/api/proposals/${proposalId}/feasibility-site-data`);
        setSite(data);
      } catch (err: any) {
        setError(err?.message || t('feas_error_generic'));
        return;
      } finally {
        setSiteLoading(false);
      }
    }
    if (!data?.address) { setNotice(t('feas_map_no_address')); return; }
    setMapOpen(true);
  };

  const limitReached = value.length >= MAX_PROPOSAL_ILLUSTRATIONS;
  const limitMessage = t('prop_illus_limit', { max: MAX_PROPOSAL_ILLUSTRATIONS }) as string;

  const addMap = async (ill: ProposalIllustration) => {
    setMapOpen(false);
    await persist([...valueRef.current, ill]);
  };

  // Photos externes à ArchiOffice : réduites en JPEG puis déposées comme documents de la proposition.
  const uploadPhotos = async (photos: PhotoWithCaption[]) => {
    setNotice(null);
    setError(null);
    const room = MAX_PROPOSAL_ILLUSTRATIONS - valueRef.current.length;
    if (!photos.length || room <= 0) { setPendingPhotos(null); if (room <= 0) setError(limitMessage); return; }
    setUploading(true);
    const added: ProposalIllustration[] = [];
    const rejected: string[] = [];
    try {
      const token = await getAccessToken();
      for (const { file, caption } of photos.slice(0, room)) {
        try {
          if (!file.type.startsWith('image/') || file.size > PHOTO_MAX_INPUT_BYTES) throw new Error('unsupported');
          const blob = await photoToJpeg(file);
          const name = `${photoLabel(file.name) || 'Photo'}.jpg`;
          const form = new FormData();
          form.append('file', new File([blob], name, { type: 'image/jpeg' }));
          form.append('resource_type', 'proposals');
          form.append('resource_id', proposalId);
          form.append('name', name);
          form.append('category', 'Plan et photos');
          const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.id) throw new Error(data?.error || 'upload');
          added.push({ document_id: data.id, file_url: data.file_url, layer: 'photo', scale: 0, caption, captured_at: new Date().toISOString() });
        } catch {
          rejected.push(file.name);
        }
      }
      if (added.length) await persist([...valueRef.current, ...added]);
      if (rejected.length) setError(t('feas_photo_error', { files: rejected.join(', ') }) as string);
      else if (photos.length > room) setNotice(limitMessage);
    } finally {
      setUploading(false);
      setPendingPhotos(null);
    }
  };

  const updateCaption = (documentId: string, caption: string) => {
    const next = valueRef.current.map(i => (i.document_id === documentId ? { ...i, caption } : i));
    valueRef.current = next;
    onChange(next);
  };

  const remove = async (documentId: string) => {
    await persist(valueRef.current.filter(i => i.document_id !== documentId));
    // Meilleur effort : un rôle sans droit de suppression garde le document dans les pièces de la proposition.
    apiFetch(`/api/documents/${documentId}`, { method: 'DELETE' }).catch(() => {});
  };

  return (
    <div className="space-y-3 pb-2">
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('prop_illus_hint')}</p>

      {error && <div role="alert" className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>{error}</div>}
      {notice && <div role="status" className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>{notice}</div>}

      {value.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {value.map(ill => (
            <figure key={ill.document_id} className="space-y-1">
              <div className="relative rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
                <SignedImage src={ill.file_url} alt={ill.caption} className="w-full h-auto block" />
                <button type="button" onClick={() => void remove(ill.document_id)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-full" aria-label={t('feas_remove_illustration') as string}
                  style={{ background: 'rgba(255,255,255,0.9)', color: '#111' }}>
                  <IconX size={14} />
                </button>
              </div>
              <input className="w-full px-2 py-1 rounded text-xs italic" style={inputStyle} defaultValue={ill.caption} maxLength={300}
                placeholder={t('feas_map_caption') as string}
                onChange={e => updateCaption(ill.document_id, e.target.value)}
                onBlur={() => void persist(valueRef.current)} />
            </figure>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => (limitReached ? setError(limitMessage) : void openMap())} disabled={siteLoading}
          className="flex items-center gap-1 text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-lg disabled:opacity-60" style={softButton}>
          {siteLoading ? <IconLoader2 size={12} className="animate-spin" /> : <IconMap2 size={12} />} {t('feas_map')}
        </button>
        <button type="button" disabled={uploading}
          onClick={() => (limitReached ? setError(limitMessage) : photoInputRef.current?.click())}
          className="flex items-center gap-1 text-[0.6875rem] font-bold uppercase px-2 py-1 rounded-lg disabled:opacity-60" style={softButton}>
          {uploading ? <IconLoader2 size={12} className="animate-spin" /> : <IconPhoto size={12} />} {t('feas_photo')}
        </button>
      </div>

      <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" aria-label={t('feas_photo') as string}
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) setPendingPhotos(files);
        }} />

      {pendingPhotos && (
        <FeasibilityPhotoDialog
          files={pendingPhotos}
          saving={uploading}
          onConfirm={photos => void uploadPhotos(photos)}
          onClose={() => setPendingPhotos(null)}
        />
      )}

      {mapOpen && site?.address && (
        <FeasibilityMapDialog
          proposalId={proposalId}
          lat={site.address.lat}
          lon={site.address.lon}
          parcelGeometry={parcelGeometry}
          onInsert={ill => void addMap(ill)}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}
