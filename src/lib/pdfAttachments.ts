// ── Pièces jointes ajoutées à la suite d'un PDF généré ───────────────────────
// Un compte-rendu de chantier peut être accompagné d'un document (compte rendu
// OPC, notice, planning...) : ses pages sont ajoutées après celles du compte-rendu
// dans un seul fichier. PDF repris tel quel (texte et vecteurs conservés), image
// JPEG ou PNG posée sur une page A4 à l'orientation de l'image.

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export type AttachmentKind = 'pdf' | 'jpeg' | 'png';

export interface AttachmentCheck {
  ok: boolean;
  kind?: AttachmentKind;
  error?: string;
}

const A4_W = 595.28;
const A4_H = 841.89;
const IMAGE_MARGIN = 28;

export function attachmentKind(file: { name: string; type?: string }): AttachmentKind | null {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpeg';
  if (type === 'image/png' || name.endsWith('.png')) return 'png';
  return null;
}

/** Contrôle un fichier avant son ajout : format pris en charge, taille, nombre déjà joint. */
export function checkAttachment(file: { name: string; type?: string; size: number }, alreadyAttached: number): AttachmentCheck {
  if (alreadyAttached >= MAX_ATTACHMENTS) {
    return { ok: false, error: `${MAX_ATTACHMENTS} documents au plus peuvent être joints.` };
  }
  const kind = attachmentKind(file);
  if (!kind) return { ok: false, error: `« ${file.name} » : seuls les PDF et les images JPEG ou PNG sont acceptés.` };
  if (file.size <= 0) return { ok: false, error: `« ${file.name} » est vide.` };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `« ${file.name} » dépasse ${MAX_ATTACHMENT_BYTES / 1024 / 1024} Mo.` };
  }
  return { ok: true, kind };
}

/** Dimensions de l'image une fois ajustée à la zone utile d'une page, sans l'agrandir au-delà de sa taille. */
export function fitImage(width: number, height: number, pageW: number, pageH: number, margin = IMAGE_MARGIN) {
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const w = width * scale;
  const h = height * scale;
  return { w, h, x: (pageW - w) / 2, y: (pageH - h) / 2 };
}

/**
 * Ajoute les fichiers à la suite du PDF `base`. Un fichier illisible (PDF protégé ou
 * corrompu, image invalide) fait échouer l'ensemble avec son nom : mieux vaut le dire
 * que diffuser un compte-rendu amputé de la pièce annoncée.
 */
export async function appendAttachments(base: Blob, files: File[]): Promise<Blob> {
  if (files.length === 0) return base;
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.load(await base.arrayBuffer());

  for (const file of files) {
    const kind = attachmentKind(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      if (kind === 'pdf') {
        const source = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } else if (kind === 'jpeg' || kind === 'png') {
        const image = kind === 'jpeg' ? await merged.embedJpg(bytes) : await merged.embedPng(bytes);
        const landscape = image.width > image.height;
        const pageW = landscape ? A4_H : A4_W;
        const pageH = landscape ? A4_W : A4_H;
        const page = merged.addPage([pageW, pageH]);
        const { w, h, x, y } = fitImage(image.width, image.height, pageW, pageH);
        page.drawImage(image, { x, y, width: w, height: h });
      } else {
        throw new Error('format non pris en charge');
      }
    } catch (err) {
      const reason = err instanceof Error && /encrypt/i.test(err.message) ? 'PDF protégé par un mot de passe' : 'fichier illisible';
      throw new Error(`« ${file.name} » n'a pas pu être ajouté au PDF (${reason}).`);
    }
  }

  const out = await merged.save();
  return new Blob([out], { type: 'application/pdf' });
}
