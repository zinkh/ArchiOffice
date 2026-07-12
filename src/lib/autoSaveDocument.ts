import { getAccessToken } from './authToken';
import type { DocumentPhase } from '../types';

export interface AutoSaveDocumentOptions {
  blob: Blob;
  filename: string;
  name: string;
  projectId?: string;
  phase: DocumentPhase;
  category?: string;
}

/**
 * Auto-save an app-generated document (PDF/XLSX) to the Documents module.
 * Silently fails — never blocks the download flow.
 */
export async function autoSaveDocument(opts: AutoSaveDocumentOptions): Promise<void> {
  try {
    const token = await getAccessToken();
    if (!token) return;

    const formData = new FormData();
    formData.append('file', opts.blob, opts.filename);
    formData.append('name', opts.name);
    formData.append('project_id', opts.projectId || '');
    formData.append('phase', opts.phase);
    formData.append('category', opts.category || 'Report');
    formData.append('description', `Généré automatiquement`);
    formData.append('uploaded_by', 'System');

    await fetch('/api/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  } catch {
    // silent — auto-save must never block the user
  }
}
