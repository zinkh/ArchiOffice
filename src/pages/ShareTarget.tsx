import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconFile,
  IconLink,
  IconLoader2,
  IconShare3,
  IconUpload,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { useUser } from '../UserContext';
import type { Project } from '../types';

const SHARE_DB_NAME = 'archioffice-share-target';
const SHARE_DB_VERSION = 1;
const SHARE_STORE = 'shares';

const PHASES = ['Général', 'ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'] as const;
const CATEGORIES = ['General', 'Plans', 'Administratif', 'Courriers', 'Photos', 'Comptabilité', 'Autre'];

interface StoredSharedFile {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
}

interface PendingShare {
  id: string;
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: StoredSharedFile[];
}

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossible d’ouvrir le stockage du partage.'));
  });
}

async function getPendingShare(id: string): Promise<PendingShare | null> {
  const db = await openShareDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readonly');
      const request = tx.objectStore(SHARE_STORE).get(id);
      request.onsuccess = () => resolve((request.result as PendingShare | undefined) || null);
      request.onerror = () => reject(request.error || new Error('Impossible de lire le partage.'));
    });
  } finally {
    db.close();
  }
}

async function deletePendingShare(id: string): Promise<void> {
  const db = await openShareDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Impossible de supprimer le partage temporaire.'));
      tx.onabort = () => reject(tx.error || new Error('Suppression du partage temporaire annulée.'));
    });
  } finally {
    db.close();
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function shareText(share: PendingShare): string {
  return [share.title, share.text, share.url].filter(Boolean).join('\n').trim();
}

function materializeFiles(share: PendingShare): File[] {
  const files = share.files.map(file => new File(
    [file.blob],
    file.name || 'partage',
    { type: file.type || file.blob.type || 'application/octet-stream', lastModified: file.lastModified || Date.now() },
  ));

  if (files.length > 0) return files;

  const text = shareText(share);
  if (!text) return [];
  const safeTitle = (share.title || 'partage')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'partage';

  return [new File([text + '\n'], `${safeTitle}.txt`, { type: 'text/plain' })];
}

export default function ShareTarget() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useUser();

  const shareId = searchParams.get('shareId') || '';
  const shareError = searchParams.get('shareError') === '1';

  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('General');
  const [phase, setPhase] = useState<(typeof PHASES)[number]>('Général');
  const [docType, setDocType] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(
    shareError ? 'Android n’a pas pu transmettre ce partage à ArchiOffice.' : null,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!shareId) {
        if (!shareError) setError('Aucun partage Android en attente.');
        setLoading(false);
        return;
      }

      try {
        const [share, projectList] = await Promise.all([
          getPendingShare(shareId),
          apiFetch<Project[]>('/api/projects'),
        ]);
        if (cancelled) return;
        if (!share) {
          setError('Ce partage n’est plus disponible. Il a peut-être déjà été importé.');
        } else {
          setPendingShare(share);
        }
        setProjects((projectList || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Impossible de préparer le partage.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [shareId, shareError]);

  const files = useMemo(() => pendingShare ? materializeFiles(pendingShare) : [], [pendingShare]);
  const contextText = pendingShare ? shareText(pendingShare) : '';

  async function upload() {
    if (!pendingShare || files.length === 0 || uploading) return;
    setUploading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('project_id', projectId);
        form.append('name', file.name);
        form.append('category', category);
        form.append('phase', phase);
        form.append('description', contextText);
        form.append('indice', 'A');
        form.append('emetteur', currentUser?.name || '');
        form.append('doc_type', docType);

        const response = await fetch('/api/documents', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Échec de l’import de « ${file.name} » (${response.status}).`);
        }
      }

      await deletePendingShare(pendingShare.id);
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Échec de l’import.');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <IconLoader2 size={28} className="animate-spin" style={{ color: 'var(--tblr-primary)' }} />
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-xl mx-auto py-8">
        <div
          className="rounded-2xl border p-6 text-center"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
        >
          <IconCircleCheck size={44} className="mx-auto mb-3 text-green-500" />
          <h2 className="text-xl font-bold mb-1">Partage importé</h2>
          <p className="text-sm mb-5" style={{ color: 'var(--tblr-muted)' }}>
            {files.length > 1 ? `${files.length} fichiers ont été ajoutés à ArchiOffice.` : 'Le document a été ajouté à ArchiOffice.'}
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-2">
            {projectId && (
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectId}`)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: 'var(--tblr-primary)' }}
              >
                Ouvrir l’affaire
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/documents')}
              className="px-4 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
            >
              Voir les documents
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-4 sm:py-8">
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
        >
          <IconShare3 size={23} />
        </div>
        <div>
          <h1 className="text-xl font-bold">Ajouter à ArchiOffice</h1>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
            Classez le contenu reçu depuis le menu Partager d’Android.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-300">
          <IconAlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {pendingShare && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
        >
          <div className="p-4 sm:p-5 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
              Contenu reçu
            </p>

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                    style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
                  >
                    <IconFile size={18} className="shrink-0" style={{ color: 'var(--tblr-primary)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                        {file.type || 'Fichier'} · {formatSize(file.size)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {contextText && pendingShare.files.length > 0 && (
              <div className="mt-3 flex items-start gap-2 text-sm" style={{ color: 'var(--tblr-muted)' }}>
                <IconLink size={16} className="shrink-0 mt-0.5" />
                <p className="whitespace-pre-wrap break-words line-clamp-4">{contextText}</p>
              </div>
            )}
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                Affaire
              </label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
              >
                <option value="">Documents généraux — sans affaire</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                  Catégorie
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  {CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                  Phase
                </label>
                <select
                  value={phase}
                  onChange={e => setPhase(e.target.value as (typeof PHASES)[number])}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  {PHASES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--tblr-muted)' }}>
                Type de document
              </label>
              <input
                value={docType}
                onChange={e => setDocType(e.target.value)}
                placeholder="Plan, CR réunion, devis, photo…"
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => navigate(-1)}
                disabled={uploading}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold border disabled:opacity-50"
                style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={upload}
                disabled={uploading || files.length === 0}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--tblr-primary)' }}
              >
                {uploading ? <IconLoader2 size={17} className="animate-spin" /> : <IconUpload size={17} />}
                {uploading ? 'Import en cours…' : files.length > 1 ? `Importer ${files.length} fichiers` : 'Importer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
