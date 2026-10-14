// ── En-tête des pages suivantes d'un document Word ───────────────────────────
// Même règle que les PDF (pdfLetterhead.drawCompactHeader) : le logo et les
// coordonnées ne figurent que sur la PREMIÈRE page ; les suivantes portent une
// seule ligne, l'agence en texte à gauche et le nom du document à droite.
import type { Header, Footer, Paragraph } from 'docx';

/** Largeur utile d'une page A4 aux marges par défaut de Word (21 cm - 2 x 2,54 cm), en twips. */
const LARGEUR_UTILE = 9026;

export interface SectionChrome {
  properties: { titlePage: true };
  headers: { first: Header; default: Header };
  footers?: { first: Footer; default: Footer };
}

/**
 * Propriétés d'une section Word : en-tête complet sur la première page, ligne
 * réduite ensuite, même pied de page partout. `firstHeader` vide : la première
 * page n'a pas d'en-tête (le document porte déjà le sien dans son corps).
 */
export async function docxSectionChrome(opts: {
  agencyName?: string;
  documentTitle: string;
  firstHeader?: Paragraph[];
  footer?: Paragraph[];
}): Promise<SectionChrome> {
  const { Header, Footer, Paragraph, TextRun, BorderStyle } = await import('docx');
  const compact = new Header({
    children: [new Paragraph({
      tabStops: [{ type: 'right' as any, position: LARGEUR_UTILE }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 2 } },
      spacing: { after: 160 },
      children: [
        new TextRun({ text: opts.agencyName || '', bold: true, size: 16, color: '111827' }),
        new TextRun({ text: `\t${opts.documentTitle}`, size: 16, color: '6B7280' }),
      ],
    })],
  });
  const first = new Header({ children: opts.firstHeader?.length ? opts.firstHeader : [new Paragraph({})] });
  return {
    properties: { titlePage: true },
    headers: { first, default: compact },
    ...(opts.footer ? { footers: { first: new Footer({ children: opts.footer }), default: new Footer({ children: opts.footer }) } } : {}),
  };
}
