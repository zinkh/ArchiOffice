// ── En-tête des pages suivantes d'un document Word ───────────────────────────
// Même règle que les PDF (pdfLetterhead.drawCompactHeader) : le logo et les
// coordonnées ne figurent que sur la PREMIÈRE page ; les suivantes portent une
// seule ligne, l'agence en texte à gauche et le nom du document à droite.
import type { Header, Footer, Paragraph } from 'docx';
import { largeurUtileWord, type Orientation } from './exportOrientation';

/** Dimensions d'une page A4 portrait en twips : docx les permute lui-même en paysage. */
const A4_LARGEUR = 11906;
const A4_HAUTEUR = 16838;

/**
 * Police de la charte pour les documents Word : sans style par défaut, Word
 * retombe sur Times New Roman. Ne fixe que la police (tailles et couleurs
 * restent à chaque document).
 */
export const STYLES_WORD_ARIAL = {
  default: {
    document: { run: { font: 'Arial' } },
    title: { run: { font: 'Arial' } },
    heading1: { run: { font: 'Arial' } },
    heading2: { run: { font: 'Arial' } },
    heading3: { run: { font: 'Arial' } },
    heading4: { run: { font: 'Arial' } },
    heading5: { run: { font: 'Arial' } },
    heading6: { run: { font: 'Arial' } },
  },
};

export interface SectionChrome {
  properties: { titlePage: true; page: { size: { width: number; height: number; orientation: any } } };
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
  /** Orientation de la page A4 ; absente, vertical comme avant. */
  orientation?: Orientation;
}): Promise<SectionChrome> {
  const { Header, Footer, Paragraph, TextRun, BorderStyle, PageOrientation } = await import('docx');
  const orientation = opts.orientation ?? 'portrait';
  const compact = new Header({
    children: [new Paragraph({
      tabStops: [{ type: 'right' as any, position: largeurUtileWord(orientation) }],
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
    properties: {
      titlePage: true,
      page: {
        size: {
          width: A4_LARGEUR, height: A4_HAUTEUR,
          orientation: orientation === 'paysage' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
      },
    },
    headers: { first, default: compact },
    ...(opts.footer ? { footers: { first: new Footer({ children: opts.footer }), default: new Footer({ children: opts.footer }) } } : {}),
  };
}
