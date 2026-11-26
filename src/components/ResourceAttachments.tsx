// Pièces jointes rattachées à une fiche autre qu'un projet (permis, appel
// d'offres, devis, réunion...) — pendant UI du rattachement générique
// resource_type/resource_id introduit côté serveur
// (supabase/migrate_documents_attachments.sql, server/routes/documents.ts)
// et exposé côté MCP (upload_document/list_documents/get_document/
// delete_document). Volontairement autonome : pas de dépendance à l'onglet
// Documents d'une affaire (qui reste sur project_id), pour rester utilisable
// depuis n'importe quelle fiche sans y importer tout ProjectDetail.tsx.
import React, { useEffect, useRef, useState } from 'react';
import { IconFile, IconLink, IconTrash, IconUpload, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { getAccessToken } from '../lib/authToken';

export interface ResourceAttachment {
  id: string;
  name: string;
  category: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  file_url: string;
}

// Doit rester aligné sur ATTACHABLE_RESOURCE_TYPES (server/routes/documents.ts).
export type AttachableResourceType =
  | 'projects' | 'contacts' | 'proposals' | 'tenders' | 'permits' | 'meetings'
  | 'receptions' | 'reserves' | 'contrats_moe' | 'ordres_de_service' | 'visas'
  | 'notes_honoraires' | 'marches_entreprises' | 'tasks' | 'milestones' | 'agents'
  | 'agency_library' | 'ftm' | 'devis_travaux_modificatifs' | 'kb_pages';

/** Doit rester aligné sur LINK_MIME_TYPE (server/routes/documents.ts) : une pièce jointe sans fichier, qui est un lien web. */
export const LINK_MIME_TYPE = 'text/uri-list';

export function isLinkAttachment(doc: { mime_type: string | null }): boolean {
  return doc.mime_type === LINK_MIME_TYPE;
}

/** Ouvre un lien enregistré, seulement s'il est en http(s) (jamais javascript: ni data:). */
function openLink(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
  } catch { /* adresse illisible : rien à ouvrir */ }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// apiFetch force un Content-Type JSON dès qu'un body est fourni, ce qui
// casse la frontière (boundary) d'un FormData — même contournement que
// ActivityFeed.tsx/MailComposeModal.tsx : un fetch nu, le token en tête,
// le reste (en-tête de cabinet compris) posé par l'intercepteur global de
// window.fetch (src/lib/authInterceptor.ts) puisque l'URL est sous /api/.
async function postForm<T>(url: string, form: FormData): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Échec du dépôt (${res.status}).`);
  return data;
}

/** Dépose des fichiers sur une fiche (même appel que le bouton « Ajouter » de ResourceAttachments). */
export async function uploadResourceFiles(resourceType: AttachableResourceType, resourceId: string, files: File[], category?: string): Promise<void> {
  for (const file of files) {
    const form = new FormData();
    form.append('file', file);
    form.append('resource_type', resourceType);
    form.append('resource_id', resourceId);
    form.append('name', file.name);
    if (category) form.append('category', category);
    await postForm('/api/documents', form);
  }
}

export function ResourceAttachments({ resourceType, resourceId, category }: {
  resourceType: AttachableResourceType;
  resourceId: string;
  /** Classement posé automatiquement sur chaque dépôt (ex. "CERFA" pour un permis). */
  category?: string;
}) {
  const [docs, setDocs] = useState<ResourceAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<ResourceAttachment[]>(`/api/documents?resource_type=${resourceType}&resource_id=${encodeURIComponent(resourceId)}`);
      setDocs(data);
    } catch (e: any) {
      setError(e?.message || 'Impossible de charger les pièces jointes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [resourceType, resourceId]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        form.append('resource_type', resourceType);
        form.append('resource_id', resourceId);
        form.append('name', file.name);
        if (category) form.append('category', category);
        await postForm('/api/documents', form);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Échec de l'envoi.");
    } finally {
      setUploading(false);
    }
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    setSavingLink(true);
    setError(null);
    try {
      await apiFetch('/api/documents/link', {
        method: 'POST',
        body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId, url: linkUrl.trim(), name: linkName.trim() || undefined }),
      });
      setLinkUrl('');
      setLinkName('');
      setLinkFormOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.message || "Impossible d'ajouter le lien.");
    } finally {
      setSavingLink(false);
    }
  }

  async function handleDelete(doc: ResourceAttachment) {
    if (!confirm(`Supprimer « ${doc.name} » ?`)) return;
    try {
      await apiFetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      setDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch (e: any) {
      setError(e?.message || 'Échec de la suppression.');
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current += 1;
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  return (
    <div
      className={`space-y-2 rounded-lg transition-colors ${dragOver ? 'bg-[var(--tblr-primary-lt)] ring-2 ring-[var(--tblr-primary)] ring-dashed' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase text-[var(--tblr-muted)]">Pièces jointes</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLinkFormOpen(open => !open)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold transition"
          >
            <IconLink size={13} />
            Lien
          </button>
          <label className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold cursor-pointer transition">
            {uploading ? <IconLoader2 size={13} className="animate-spin" /> : <IconUpload size={13} />}
            Ajouter
            <input type="file" multiple className="hidden" disabled={uploading} onChange={e => handleUpload(e.target.files)} />
          </label>
        </div>
      </div>
      {linkFormOpen && (
        <form onSubmit={handleAddLink} className="flex flex-wrap items-center gap-2 p-2 border border-[var(--tblr-border)] rounded-lg">
          <input
            type="text"
            inputMode="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            placeholder="https://www.exemple.fr/page"
            aria-label="Adresse du site"
            className="flex-1 min-w-[12rem] px-2 py-1 text-xs bg-transparent border border-[var(--tblr-border)] rounded"
            autoFocus
          />
          <input
            type="text"
            value={linkName}
            onChange={e => setLinkName(e.target.value)}
            placeholder="Titre (facultatif)"
            aria-label="Titre du lien"
            className="flex-1 min-w-[8rem] px-2 py-1 text-xs bg-transparent border border-[var(--tblr-border)] rounded"
          />
          <button type="submit" disabled={savingLink || !linkUrl.trim()} className="px-2.5 py-1 text-xs font-bold bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 rounded-lg disabled:opacity-50">
            {savingLink ? 'Ajout…' : 'Enregistrer le lien'}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {loading ? (
        <p className="text-xs text-[var(--tblr-muted)] italic">Chargement…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-[var(--tblr-muted)] italic">
          {dragOver ? 'Déposez les fichiers ici…' : 'Aucune pièce jointe. Glissez-déposez des fichiers ici ou ajoutez un lien.'}
        </p>
      ) : (
        <div className="space-y-1">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg group">
              <button
                type="button"
                onClick={() => (isLinkAttachment(doc) ? openLink(doc.file_url) : openSignedUrl(doc.file_url))}
                className="flex items-center gap-2 min-w-0 text-left hover:underline"
                title={isLinkAttachment(doc) ? doc.file_url : 'Ouvrir'}
              >
                {isLinkAttachment(doc)
                  ? <IconLink size={14} className="shrink-0 text-[var(--tblr-muted)]" />
                  : <IconFile size={14} className="shrink-0 text-[var(--tblr-muted)]" />}
                <span className="text-xs truncate">{doc.name}</span>
                {doc.category && <span className="text-[0.6875rem] uppercase font-bold text-[var(--tblr-muted)] shrink-0">{doc.category}</span>}
                {isLinkAttachment(doc)
                  ? <span className="text-[0.6875rem] text-[var(--tblr-muted)] truncate">{doc.file_url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  : <span className="text-[0.6875rem] text-[var(--tblr-muted)] shrink-0">{formatSize(doc.size_bytes)}</span>}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(doc)}
                className="p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition rounded shrink-0"
                title="Supprimer"
              >
                <IconTrash size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
