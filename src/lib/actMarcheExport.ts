// ── Rendu PDF et Word des documents du marché (RC, CCAP, acte d'engagement) ──
// Charte du cabinet : en-tête (logo, coordonnées), nuances de gris, pied de page
// avec l'adresse et pagination « P1|2 ». Le contenu vient de `actMarche.ts`.
import type { AgencySettings } from './proposalExport';
import { agencyFooterLine, drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl } from './pdfLetterhead';
import { partnerLogosParagraph } from './docxPartnerLogos';
import type { Bloc, DocModele } from './actMarche';

const nomFichier = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FOND: [number, number, number] = [235, 236, 238];
const MARGE = 16;
const BAS_UTILE = 281; // 297 − pied de page

function telecharger(blob: Blob, nom: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/** Un seul PDF pour un ou plusieurs documents : chacun repart sur une nouvelle page. */
export async function exporterMarchePdf(docs: DocModele[], settings: AgencySettings, nom: string): Promise<void> {
  const [{ default: jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogoDataUrl(settings.logoUrl)]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const largeur = pdf.internal.pageSize.getWidth() - MARGE * 2;
  let y = 0;
  let courant: DocModele = docs[0];

  const entete = () => drawAgencyHeader(pdf, settings, {
    title: courant.titre.length > 40 ? 'Marché de travaux' : courant.titre,
    subtitle: courant.sousTitre, reference: courant.reference, logo, margin: MARGE,
  });
  const nouvellePage = () => { pdf.addPage(); y = entete(); };
  const place = (h: number) => { if (y + h > BAS_UTILE) nouvellePage(); };

  const texte = (txt: string, o: { gras?: boolean; taille?: number; retrait?: number; couleur?: [number, number, number]; apres?: number; italique?: boolean } = {}) => {
    const taille = o.taille ?? 9.5;
    pdf.setFont('helvetica', o.gras ? 'bold' : o.italique ? 'italic' : 'normal');
    pdf.setFontSize(taille);
    pdf.setTextColor(...(o.couleur ?? GRIS_TEXTE));
    const lignes = pdf.splitTextToSize(txt, largeur - (o.retrait ?? 0)) as string[];
    const pas = taille * 0.4;
    for (const l of lignes) { place(pas); pdf.text(l, MARGE + (o.retrait ?? 0), y + pas * 0.8); y += pas; }
    y += o.apres ?? 1.6;
  };

  const rendreBloc = (bloc: Bloc) => {
    if (bloc.t === 'h') {
      place(14);
      y += 3;
      pdf.setFillColor(...GRIS_FOND);
      pdf.rect(MARGE, y - 1, largeur, 7, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...GRIS_TEXTE);
      pdf.text(bloc.text.toUpperCase(), MARGE + 2, y + 4);
      y += 9;
    } else if (bloc.t === 'sh') {
      place(10); texte(bloc.text, { gras: true, apres: 1 });
    } else if (bloc.t === 'p') {
      texte(bloc.text, { apres: 2 });
    } else if (bloc.t === 'li') {
      place(5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...GRIS_TEXTE);
      pdf.text('•', MARGE + 3, y + 3.1);
      texte(bloc.text, { retrait: 8, apres: 1 });
    } else if (bloc.t === 'kv') {
      pdf.setFontSize(9.5);
      const colCle = Math.min(78, largeur * 0.45);
      for (const [k, val] of bloc.rows) {
        pdf.setFont('helvetica', 'bold');
        const lk = pdf.splitTextToSize(k, colCle - 3) as string[];
        pdf.setFont('helvetica', 'normal');
        const lv = pdf.splitTextToSize(val, largeur - colCle) as string[];
        const n = Math.max(lk.length, lv.length);
        place(n * 3.9 + 1.5);
        pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...GRIS_DOUX);
        pdf.text(lk, MARGE, y + 3.1);
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GRIS_TEXTE);
        pdf.text(lv, MARGE + colCle, y + 3.1);
        y += n * 3.9 + 1.5;
      }
      y += 2;
    } else if (bloc.t === 'sign') {
      place(34);
      y += 6;
      const w = largeur / bloc.labels.length;
      bloc.labels.forEach((l, i) => {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...GRIS_TEXTE);
        pdf.text(l, MARGE + i * w, y);
      });
      y += 28;
    }
  };

  docs.forEach((doc, i) => {
    courant = doc;
    if (i > 0) pdf.addPage();
    y = entete();
    // Titre du document, centré sous l'en-tête.
    y += 4;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...GRIS_TEXTE);
    const titre = pdf.splitTextToSize(doc.titre, largeur) as string[];
    titre.forEach(l => { pdf.text(l, MARGE + largeur / 2, y + 5, { align: 'center' }); y += 7; });
    if (doc.sousTitre) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...GRIS_DOUX);
      pdf.text(doc.sousTitre, MARGE + largeur / 2, y + 5, { align: 'center' });
      y += 9;
    }
    y += 3;
    doc.blocs.forEach(rendreBloc);
  });

  drawAgencyFooters(pdf, settings, { title: docs[0].titre, margin: MARGE });
  pdf.save(`${nomFichier(nom)}.pdf`);
}

// ── Word ─────────────────────────────────────────────────────────────────────

export async function exporterMarcheDocx(docs: DocModele[], settings: AgencySettings, nom: string): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, PageNumber, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType,
  } = await import('docx');
  type Para = InstanceType<typeof Paragraph>;

  const logo = await loadLogoDataUrl(settings.logoUrl);
  const entete: Para[] = [];
  if (logo) {
    const h = 40;
    const data = Uint8Array.from(atob(logo.dataUrl.split(',')[1]), c => c.charCodeAt(0));
    entete.push(new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round((logo.width / logo.height) * h), height: h } })] }));
  }
  entete.push(
    new Paragraph({ children: [new TextRun({ text: settings.agencyName || '', bold: true, size: 20, color: '111827' })] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } },
      spacing: { after: 120 },
      children: [new TextRun({ text: [settings.address, settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  '), size: 15, color: '6B7280' })],
    }),
  );
  const bandeau = await partnerLogosParagraph();
  if (bandeau) entete.push(bandeau);

  const pied = [
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } }, children: [new TextRun({ text: agencyFooterLine(settings), size: 13, color: '6B7280' })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [
      new TextRun({ text: 'P', bold: true, size: 15, color: '111827' }),
      new TextRun({ children: [PageNumber.CURRENT], bold: true, size: 15, color: '111827' }),
      new TextRun({ text: '|', bold: true, size: 15, color: '111827' }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], bold: true, size: 15, color: '111827' }),
    ] }),
  ];

  const aucune = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const bordures = { top: aucune, bottom: aucune, left: aucune, right: aucune };

  const rendreBloc = (b: Bloc): (Para | InstanceType<typeof Table>)[] => {
    switch (b.t) {
      case 'h': return [new Paragraph({ spacing: { before: 280, after: 100 }, shading: { fill: 'EBECEE' }, children: [new TextRun({ text: b.text.toUpperCase(), bold: true, size: 21, color: '111827' })] })];
      case 'sh': return [new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: b.text, bold: true, size: 20, color: '111827' })] })];
      case 'p': return [new Paragraph({ spacing: { after: 100 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: b.text, size: 20, color: '111827' })] })];
      case 'li': return [new Paragraph({ spacing: { after: 40 }, bullet: { level: 0 }, children: [new TextRun({ text: b.text, size: 20, color: '111827' })] })];
      case 'kv': return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.rows.map(([k, val]) => new TableRow({ children: [
          new TableCell({ width: { size: 45, type: WidthType.PERCENTAGE }, borders: bordures, children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 19, color: '6B7280' })] })] }),
          new TableCell({ width: { size: 55, type: WidthType.PERCENTAGE }, borders: bordures, children: [new Paragraph({ children: [new TextRun({ text: val, size: 20, color: '111827' })] })] }),
        ] })),
      }), new Paragraph({ children: [] })];
      case 'sign': return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ height: { value: 1500, rule: 'atLeast' }, children: b.labels.map(l => new TableCell({
          borders: bordures,
          children: [new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: l, bold: true, size: 19, color: '111827' })] })],
        })) })],
      })];
    }
  };

  const sections = docs.map(doc => ({
    properties: {},
    headers: { default: new Header({ children: entete }) },
    footers: { default: new Footer({ children: pied }) },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 }, children: [new TextRun({ text: doc.titre, bold: true, size: 30, color: '111827' })] }),
      ...(doc.sousTitre ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: doc.sousTitre, size: 21, color: '6B7280' })] })] : []),
      ...doc.blocs.flatMap(rendreBloc),
    ],
  }));

  const blob = await Packer.toBlob(new Document({ sections }));
  telecharger(blob, `${nomFichier(nom)}.docx`);
}
