// Pièces jointes des mails envoyés depuis l'application (facture, sollicitation
// d'appel d'offres, message libre...). Le format {filename, content, encoding}
// est celui que nodemailer attend tel quel — POST /api/send-email
// (server/routes/sendEmail.ts) relaie `attachments` sans le retoucher.
import { apiFetch } from './api';
import { resolveSignedUrl } from './signedStorageUrl';

export interface EmailAttachment {
  filename: string;
  content: string; // base64, sans le préfixe data:
  encoding: 'base64';
  contentType?: string;
}

// Marge sous les limites usuelles d'un relais SMTP (souvent 20-25 Mo une fois
// l'encodage base64 appliqué, qui gonfle la taille d'environ un tiers) —
// avertit sans jamais bloquer l'envoi, le serveur restant seul juge final.
export const MAX_EMAIL_ATTACHMENTS_BYTES = 15 * 1024 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible'));
    reader.readAsDataURL(blob);
  });
}

export async function fileToEmailAttachment(file: File): Promise<EmailAttachment> {
  return { filename: file.name, content: await blobToBase64(file), encoding: 'base64', contentType: file.type || undefined };
}

// `doc` vient de GET /api/documents — file_url est une référence de stockage
// privée (voir signedStorageUrl.ts), jamais une URL directement fetchable.
export async function documentToEmailAttachment(doc: { name: string; file_url: string; mime_type?: string | null }): Promise<EmailAttachment> {
  const signedUrl = await resolveSignedUrl(doc.file_url);
  const resp = await fetch(signedUrl);
  if (!resp.ok) throw new Error(`Téléchargement du document impossible (${resp.status})`);
  const blob = await resp.blob();
  return { filename: doc.name, content: await blobToBase64(blob), encoding: 'base64', contentType: doc.mime_type || blob.type || undefined };
}

export function totalAttachmentsBytes(attachments: EmailAttachment[]): number {
  // Un base64 encode 3 octets sur 4 caractères — approximation suffisante
  // pour un simple avertissement de taille, pas un calcul exact.
  return attachments.reduce((sum, a) => sum + Math.ceil((a.content.length * 3) / 4), 0);
}

export interface AttachableDocument {
  id: string;
  name: string;
  file_url: string;
  mime_type?: string | null;
}

export async function fetchAttachableDocuments(query: { project_id?: string; resource_type?: string; resource_id?: string }): Promise<AttachableDocument[]> {
  const params = new URLSearchParams();
  if (query.project_id) params.set('project_id', query.project_id);
  if (query.resource_type) params.set('resource_type', query.resource_type);
  if (query.resource_id) params.set('resource_id', query.resource_id);
  return apiFetch<AttachableDocument[]>(`/api/documents?${params.toString()}`);
}
