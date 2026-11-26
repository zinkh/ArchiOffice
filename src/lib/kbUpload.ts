// Envoi d'un fichier rattaché à une page de la « Base de données » (POST /api/documents, resource_type
// = kb_pages). apiFetch force un Content-Type JSON qui casserait la frontière d'un FormData : un fetch nu,
// le jeton en tête, le reste (en-tête de cabinet) posé par l'intercepteur global (même contournement que
// src/components/ResourceAttachments.tsx).
import { getAccessToken } from './authToken';

export interface KbUploadedDocument {
  id: string;
  file_url: string;
  size_bytes?: number;
}

export async function uploadKbFile(pageId: string, file: File): Promise<KbUploadedDocument> {
  const form = new FormData();
  form.append('file', file);
  form.append('resource_type', 'kb_pages');
  form.append('resource_id', pageId);
  form.append('name', file.name);
  form.append('category', 'Base de données');
  const token = await getAccessToken();
  const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Échec du dépôt (${res.status}).`);
  return data as KbUploadedDocument;
}
