// Rendu PDF du PV d'OPR : parcourt les blocs de `oprPvDocument.ts`.
// Charte du cabinet : en-tête avec logo sur la première page, tableaux en nuances de
// gris, pied de page avec l'adresse et pagination « P1|2 ». Les cases à cocher sont
// dessinées : ☐ et ☑ n'existent pas dans les polices standard de jsPDF.
//
// Comme doePdf.ts, ce module ne charge ni jsPDF ni le logo : l'appelant les fournit,
// ce qui permet de l'appeler du navigateur comme de Node.
import { drawAgencyHeader, drawAgencyFooters, tableauGris, TABLEAU_GRIS, type LetterheadOptions } from './pdfLetterhead';
import { finY, tableauFiche, type RenduPdf } from './certificatPaiementPdf';
import type { BlocPv, DocPv } from './oprPvDocument';

const MARGE = 14;
const HAUT_PAGE_SUIVANTE = 22;
const BAS_UTILE = 20;
const INTERLIGNE = 4.2;
const TEXTE: [number, number, number] = [17, 24, 39];
const GRIS: [number, number, number] = [107, 114, 128];
const POINTILLES = '..........';

/** Une case de 3,2 mm, barrée d'une croix quand elle est cochée. */
function dessinerCase(pdf: any, x: number, y: number, cochee: boolean): void {
  const c = 3.2;
  pdf.setDrawColor(...TEXTE);
  pdf.setLineWidth(0.25);
  pdf.rect(x, y - c + 0.6, c, c);
  if (cochee) {
    pdf.setLineWidth(0.5);
    pdf.line(x + 0.5, y - c + 1.1, x + c - 0.5, y - 0.4);
    pdf.line(x + c - 0.5, y - c + 1.1, x + 0.5, y - 0.4);
  }
}

export function rendreDocPv(r: RenduPdf, doc: DocPv): void {
  const { pdf } = r;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const largeur = pageW - MARGE * 2;
  const options: LetterheadOptions = {
    title: doc.titre,
    subtitle: doc.sousTitre || undefined,
    reference: doc.reference || undefined,
    date: doc.date || undefined,
    margin: MARGE,
    logo: r.logo,
  };
  let y = drawAgencyHeader(pdf, r.settings, options) + 2;

  /** Saute de page si `hauteur` ne tient pas avant le pied de page. */
  const place = (hauteur: number): void => {
    if (y + hauteur > pageH - BAS_UTILE) { pdf.addPage(); y = HAUT_PAGE_SUIVANTE; }
  };

  const titre = (text: string): void => {
    place(34); // jamais un titre seul en bas de page
    y += 3;
    pdf.setFillColor(...TABLEAU_GRIS.groupe);
    pdf.rect(MARGE, y - 4.5, largeur, 7, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...TEXTE);
    pdf.text(text.toUpperCase(), MARGE + 2, y);
    y += 7;
  };

  const texte = (text: string, gras = false): void => {
    pdf.setFont('helvetica', gras ? 'bold' : 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...TEXTE);
    const lignes = pdf.splitTextToSize(text, largeur) as string[];
    place(lignes.length * INTERLIGNE + 2);
    pdf.text(lignes, MARGE, y);
    y += lignes.length * INTERLIGNE + 1;
  };

  const caseACocher = (b: Extract<BlocPv, { t: 'case' }>): void => {
    const x = MARGE + 3 + b.niveau * 9;
    const complet = b.valeur === undefined ? b.text : `${b.text} ${b.valeur === '' ? POINTILLES : b.valeur}`;
    pdf.setFont('helvetica', b.cochee ? 'bold' : 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...TEXTE);
    const lignes = pdf.splitTextToSize(complet, largeur - (x - MARGE) - 6) as string[];
    place(lignes.length * INTERLIGNE + 2);
    dessinerCase(pdf, x, y, b.cochee);
    pdf.text(lignes, x + 6, y);
    y += lignes.length * INTERLIGNE + 0.8;
  };

  const signatures = (b: Extract<BlocPv, { t: 'signatures' }>): void => {
    place(34);
    y += 2;
    const n = b.cases.length;
    const w = (largeur - 8 * (n - 1)) / n;
    pdf.setDrawColor(209, 213, 219); pdf.setLineWidth(0.3);
    b.cases.forEach((c, i) => {
      const x = MARGE + i * (w + 8);
      pdf.rect(x, y, w, 26);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...TEXTE);
      pdf.text(c.titre, x + 3, y + 5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS);
      if (c.sous) pdf.text(c.sous, x + 3, y + 9.5);
      pdf.text(`Date et signature${c.date ? `, le ${c.date}` : ''}`, x + 3, y + 23);
    });
    y += 30;
  };

  const tableau = (b: Extract<BlocPv, { t: 'tableau' }>): void => {
    place(40);
    y += 4;
    texte(b.titre.toUpperCase(), true);
    y += 1;
    const base = tableauGris(MARGE);
    r.autoTable(pdf, {
      ...base,
      startY: y,
      head: [b.entetes],
      body: b.lignes.map(l => Array.isArray(l)
        ? l
        : [{ content: l.groupe, colSpan: b.entetes.length, styles: { fontStyle: 'bold', fillColor: TABLEAU_GRIS.groupe } }]),
      styles: { ...base.styles, cellPadding: 1.6, minCellHeight: 9, valign: 'top' },
      columnStyles: Object.fromEntries(b.largeurs.map((cellWidth, i) => [i, { cellWidth }])),
      alternateRowStyles: {},
    });
    y = finY(pdf, y) + 4;
  };

  for (const b of doc.blocs) {
    switch (b.t) {
      case 'titre': titre(b.text); break;
      case 'texte': texte(b.text, b.gras); break;
      case 'case': caseACocher(b); break;
      case 'fiche':
        if (b.lignes.length) { place(30); y = tableauFiche(r, y, b.titre ?? 'Identification', b.lignes); }
        break;
      case 'signatures': signatures(b); break;
      case 'saut': pdf.addPage(); y = HAUT_PAGE_SUIVANTE; break;
      case 'tableau': tableau(b); break;
    }
  }

  drawAgencyFooters(pdf, r.settings, options);
}
