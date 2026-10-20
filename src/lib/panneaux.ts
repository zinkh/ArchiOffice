// Panneaux d'affichage (chantier et permis) : appels au serveur, téléchargement
// et rattachement du PDF généré à la fiche du permis. Voir server/panneaux/.
import { getAccessToken } from './authToken';

export type PanneauOrientation = 'portrait' | 'paysage';
export type PanneauFormat = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | '80x120' | '100x150';

export const CHANTIER_FORMATS: PanneauFormat[] = ['A0', 'A1', 'A2', 'A3'];
export const PERMIS_FORMATS: PanneauFormat[] = ['A0', '80x120', '100x150', 'A3', 'A4'];

/** Les deux côtés doivent faire au moins 80 cm (même règle que server/panneaux/pageSpec.ts). */
const SMALL_SIDE_MM: Record<PanneauFormat, number> = { A0: 841, A1: 594, A2: 420, A3: 297, A4: 210, '80x120': 800, '100x150': 1000 };
export function isRegulatoryFormat(format: PanneauFormat): boolean {
  return SMALL_SIDE_MM[format] >= 800;
}

export interface PanelPdfResult {
  blob: Blob;
  filename: string;
  warnings: string[];
  headers: Headers;
}

export class PanelRequestError extends Error {
  missing: string[];
  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = 'PanelRequestError';
    this.missing = missing;
  }
}

function filenameFrom(headers: Headers, fallback: string): string {
  const m = /filename="?([^";]+)"?/i.exec(headers.get('Content-Disposition') || '');
  return m ? m[1] : fallback;
}

function warningsFrom(headers: Headers): string[] {
  try {
    const raw = headers.get('X-Panneau-Warnings');
    const parsed = raw ? JSON.parse(decodeURIComponent(raw)) : [];
    return Array.isArray(parsed) ? parsed.filter((x: unknown): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export async function requestPanelPdf(url: string, body: unknown, fallbackName = 'panneau.pdf'): Promise<PanelPdfResult> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new PanelRequestError(data?.error || `Échec de la génération (${res.status}).`, Array.isArray(data?.missing) ? data.missing : []);
  }
  return { blob: await res.blob(), filename: filenameFrom(res.headers, fallbackName), warnings: warningsFrom(res.headers), headers: res.headers };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Dépose le PDF généré parmi les pièces jointes du permis (catégorie « Permis »). */
export async function attachPanelToPermit(permitId: string, blob: Blob, filename: string): Promise<void> {
  const token = await getAccessToken();
  const form = new FormData();
  form.append('file', new File([blob], filename, { type: 'application/pdf' }));
  form.append('resource_type', 'permits');
  form.append('resource_id', permitId);
  form.append('name', filename);
  form.append('category', 'Permis');
  const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Échec du rattachement (${res.status}).`);
  }
}

/** Brouillon du panneau au dépôt d'un PC : meilleur effort, jamais bloquant pour l'enregistrement du permis. */
export async function generatePermitDraftPanel(permitId: string): Promise<string> {
  const { blob, filename } = await requestPanelPdf(`/api/permits/${encodeURIComponent(permitId)}/panneau/pdf`, { format: 'A0', orientation: 'portrait', etat: 'brouillon' }, 'panneau-permis-brouillon.pdf');
  await attachPanelToPermit(permitId, blob, filename);
  return filename;
}
