// ── Extraction de texte partagée ────────────────────────────────────────────
// Même geste dans deux endroits différents : lire un PDF ou un DOCX, retomber
// sur l'OCR (ocr.ts) quand le document n'a pas de couche texte exploitable.
// read_email_attachment (mailAttachmentTools.ts, pièce jointe d'un message
// pas encore attachée à une fiche) et read_document (mcp/tools.ts, pièce déjà
// attachée à une fiche via upload_document/import_email_attachment) partagent
// donc cette même implémentation plutôt que d'en faire dériver deux copies.
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { ocrDocument, isOcrCandidate } from './ocr.js';

// Un devis ou une notice technique dépasse vite quelques milliers de
// caractères — 20000 reste un ordre de grandeur raisonnable pour un document
// injecté au fil d'une conversation, sans devenir un corpus à parcourir.
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;

// Couvre un éventuel passage par l'OCR (Tesseract), nettement plus lent
// qu'une simple lecture de couche texte.
export const TEXT_EXTRACTION_TIMEOUT_MS = 45_000;

export function withTextExtractionTimeout<T>(promise: Promise<T>, ms: number = TEXT_EXTRACTION_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("L'extraction du contenu a dépassé le délai imparti.")), ms)),
  ]);
}

export interface ExtractedText {
  text: string | null;
  note: string;
}

/**
 * Extrait le texte d'un fichier (PDF, DOCX, texte brut), avec repli OCR pour
 * un document scanné ou une image — jamais de vision native ici, voir la note
 * sur ctx.documentImages dans context.ts : ce chemin lit un fichier déjà
 * posé quelque part (pièce jointe de mail, document attaché à une fiche), pas
 * un document envoyé au modèle en pièce jointe réelle du message.
 */
export async function extractDocumentText(filename: string, mimeType: string, buffer: Buffer): Promise<ExtractedText> {
  const lower = filename.toLowerCase();
  let text: string | null = null;
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    text = (await pdfParse(buffer)).text;
  } else if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('csv') || mimeType.includes('xml')) {
    text = buffer.toString('utf8');
  }

  if (isOcrCandidate(lower, text)) {
    const ocr = await ocrDocument(lower, buffer).catch(() => null);
    if (ocr?.text?.trim()) {
      return {
        text: ocr.text,
        note: `[Document sans couche texte : contenu reconstitué par OCR sur ${ocr.pages} page(s). Des erreurs de reconnaissance sont possibles.]\n\n`,
      };
    }
    if (ocr?.unavailableReason && !text?.trim()) {
      return { text: null, note: `Ce document ne contient pas de texte sélectionnable et n'a pas pu être lu : ${ocr.unavailableReason}.` };
    }
  }
  return { text, note: '' };
}
