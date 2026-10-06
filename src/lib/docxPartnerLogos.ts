// Bandeau « En groupement avec » des documents Word : même contenu que celui
// des PDF (pdfLetterhead.drawPartnerLogos), pour les logos du groupement actif.
import type { Paragraph } from 'docx';
import { resolvePartnerLogos, type LogoImage } from './pdfLetterhead';

const HAUTEUR_PX = 32;
const LARGEUR_MAX_PX = 130;

/** Paragraphe de logos, ou null quand le document n'a pas de groupement à montrer. */
export async function partnerLogosParagraph(explicit?: LogoImage[]): Promise<Paragraph | null> {
  const logos = resolvePartnerLogos(explicit);
  if (logos.length === 0) return null;
  const { Paragraph, TextRun, ImageRun } = await import('docx');
  const images = logos.map(l => {
    const data = Uint8Array.from(atob(l.dataUrl.split(',')[1]), c => c.charCodeAt(0));
    let w = Math.round((l.width / l.height) * HAUTEUR_PX);
    let h = HAUTEUR_PX;
    if (w > LARGEUR_MAX_PX) { w = LARGEUR_MAX_PX; h = Math.round((l.height / l.width) * w); }
    return new ImageRun({ type: 'png', data, transformation: { width: w, height: h } });
  });
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: 'En groupement avec  ', size: 13, color: '6B7280' }),
      ...images.flatMap(img => [img, new TextRun({ text: '    ' })]),
    ],
  });
}
