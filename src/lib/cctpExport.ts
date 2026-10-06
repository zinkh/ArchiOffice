// ── Export du CCTP (PDF et Word) ─────────────────────────────────────────────
// Le CCTP est le même arbre que le DPGF (lots > chapitres > articles) lu par
// son texte technique : `cctpDescription`. Pas de quantité ni de prix, qui
// relèvent du DPGF. Deux usages :
//   - l'opération complète : chaque article dit à quels bâtiments il s'applique ;
//   - un CCTP par bâtiment : seuls ses articles (`cctpPourBatiment`).
// Charte du cabinet : en-tête avec logo, pied de page avec adresse et mentions,
// pagination « P1|2 », nuances de gris. jsPDF et docx sont chargés à la demande.
import type { Batiment, DPGF, Ligne } from '../types/dpgf';
import type { AgencySettings } from './proposalExport';
import { partnerLogosParagraph } from './docxPartnerLogos';
import { agencyFooterLine, drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl } from './pdfLetterhead';
import { batimentsDeLigne, batimentsParOrdre, cctpPourBatiment } from './batimentsArticles';

export interface CctpBloc {
  niveau: number;          // 1 lot, 2 chapitre, 3+ article et sous-articles
  numero: string;
  titre: string;
  texte: string;
  localisation?: string;
  /** Bâtiments concernés (opération complète seulement). */
  batiments?: string[];
}

export interface CctpExportOptions {
  projectName?: string;
  settings: AgencySettings;
  /** CCTP d'un seul bâtiment ; absent, l'opération complète. */
  batiment?: Batiment;
}

const libelleBatiment = (b: Batiment) => (b.libelle ? `${b.code} ${b.libelle}` : b.code);

/**
 * Le contenu à imprimer, à plat et dans l'ordre. Un article mentionne ses
 * bâtiments seulement dans le CCTP de l'opération complète d'une opération à
 * plusieurs bâtiments : dans le CCTP d'un bâtiment, la mention serait redite
 * à chaque article.
 */
export function cctpBlocs(doc: DPGF, batimentId?: string): CctpBloc[] {
  const source = batimentId ? cctpPourBatiment(doc, batimentId) : doc;
  const mention = !batimentId && !!doc.multiBatiments;
  const parId = new Map((doc.batiments ?? []).map(b => [b.id, b]));
  const ordre = new Map(batimentsParOrdre(doc.batiments).map((b, i) => [b.id, i]));
  const blocs: CctpBloc[] = [];
  const texte = (v?: string) => (v ?? '').trim();

  const articles = (lignes: Ligne[], niveau: number, herite?: string) => lignes.forEach(l => {
    const enfants = !!l.children?.length;
    const batiments = mention && !enfants
      ? batimentsDeLigne(l, herite)
        .filter(id => parId.has(id))
        .sort((a, b) => (ordre.get(a) ?? 0) - (ordre.get(b) ?? 0))
        .map(id => libelleBatiment(parId.get(id)!))
      : undefined;
    blocs.push({
      niveau, numero: l.numero, titre: l.designation, texte: texte(l.cctpDescription),
      localisation: texte(l.localisation) || undefined,
      batiments: batiments?.length ? batiments : undefined,
    });
    if (enfants) articles(l.children!, niveau + 1, l.batimentId ?? herite);
  });

  for (const lot of source.lots) {
    blocs.push({ niveau: 1, numero: lot.numero, titre: lot.titre, texte: texte((lot as { cctpDescription?: string }).cctpDescription) });
    for (const chap of lot.chapitres) {
      blocs.push({ niveau: 2, numero: chap.numero, titre: chap.titre, texte: texte(chap.cctpDescription) });
      articles(chap.lignes, 3, chap.batimentId ?? lot.batimentId);
    }
  }
  return blocs;
}

export function cctpTitre(opts: Pick<CctpExportOptions, 'batiment'>): string {
  return opts.batiment ? `CCTP · ${libelleBatiment(opts.batiment)}` : 'CCTP';
}

export function cctpNomFichier(opts: Pick<CctpExportOptions, 'projectName' | 'batiment'>, ext: 'pdf' | 'docx'): string {
  const morceaux = ['CCTP', opts.projectName, opts.batiment?.code].filter(Boolean) as string[];
  const nom = morceaux.join('_').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_');
  return `${nom}.${ext}`;
}

const SOUS_TITRE = 'Cahier des clauses techniques particulières';
const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];

// ── PDF ──────────────────────────────────────────────────────────────────────

export async function exportCctpPdf(doc: DPGF, opts: CctpExportOptions): Promise<void> {
  const [{ default: JsPDF }, logo] = await Promise.all([import('jspdf'), loadLogoDataUrl(opts.settings.logoUrl)]);
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' });
  const margin = 18;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const largeur = pageW - margin * 2;
  const letterhead = {
    title: cctpTitre(opts), subtitle: opts.projectName, reference: `v${doc.version}`, margin, logo,
  };
  let y = drawAgencyHeader(pdf, opts.settings, letterhead) + 4;
  const basDePage = pageH - 18;
  const place = (h: number) => { if (y + h > basDePage) { pdf.addPage(); y = margin; } };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(...GRIS_TEXTE);
  pdf.text(SOUS_TITRE, margin, y + 4);
  y += 10;
  if (opts.batiment) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(...GRIS_DOUX);
    pdf.text(libelleBatiment(opts.batiment), margin, y + 2);
    y += 8;
  }

  const ecrire = (valeur: string, taille: number, style: 'normal' | 'bold' | 'italic', couleur: [number, number, number], retrait = 0, apres = 1.5) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(taille);
    pdf.setTextColor(...couleur);
    const hLigne = taille * 0.42;
    for (const paragraphe of valeur.split(/\n/)) {
      const lignes = pdf.splitTextToSize(paragraphe || ' ', largeur - retrait) as string[];
      for (const ligne of lignes) {
        place(hLigne);
        pdf.text(ligne, margin + retrait, y + hLigne * 0.8);
        y += hLigne;
      }
    }
    y += apres;
  };

  for (const b of cctpBlocs(doc, opts.batiment?.id)) {
    const retrait = Math.max(0, b.niveau - 3) * 4;
    if (b.niveau === 1) { place(16); y += 4; ecrire(`${b.numero}  ${b.titre}`, 13, 'bold', GRIS_TEXTE, 0, 2); }
    else if (b.niveau === 2) { place(12); y += 2; ecrire(`${b.numero}  ${b.titre}`, 11, 'bold', GRIS_TEXTE, 0, 1.5); }
    else { place(10); ecrire(`${b.numero}  ${b.titre}`, 10, 'bold', GRIS_TEXTE, retrait, 1); }
    if (b.batiments) ecrire(`Bâtiments concernés : ${b.batiments.join(', ')}`, 8.5, 'italic', GRIS_DOUX, retrait, 1);
    if (b.localisation) ecrire(`Localisation : ${b.localisation}`, 8.5, 'italic', GRIS_DOUX, retrait, 1);
    if (b.texte) ecrire(b.texte, 9.5, 'normal', GRIS_TEXTE, retrait, 2.5);
  }

  drawAgencyFooters(pdf, opts.settings, letterhead);
  pdf.save(cctpNomFichier(opts, 'pdf'));
}

// ── Word ─────────────────────────────────────────────────────────────────────

export async function exportCctpDocx(doc: DPGF, opts: CctpExportOptions): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, PageNumber, AlignmentType, HeadingLevel, BorderStyle,
  } = await import('docx');
  const { compressImage } = await import('./imageCompression');
  const { settings } = opts;

  const headerChildren: InstanceType<typeof Paragraph>[] = [];
  const logo = settings.logoUrl ? await compressImage(settings.logoUrl, 400, 400, 0.92).catch(() => null) : null;
  if (logo) {
    const h = 40;
    headerChildren.push(new Paragraph({
      children: [new ImageRun({ type: 'jpg', data: logo.buffer, transformation: { width: Math.round((logo.w / logo.h) * h), height: h } })],
    }));
  }
  headerChildren.push(
    new Paragraph({ children: [new TextRun({ text: settings.agencyName || '', bold: true, size: 20, color: '111827' })] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } },
      spacing: { after: 120 },
      children: [new TextRun({ text: [settings.address, settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  '), size: 15, color: '6B7280' })],
    }),
  );
  const bandeau = await partnerLogosParagraph();
  if (bandeau) headerChildren.push(bandeau);
  const footerChildren = [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } },
      children: [new TextRun({ text: agencyFooterLine(settings), size: 13, color: '6B7280' })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'P', bold: true, size: 15, color: '111827' }),
        new TextRun({ children: [PageNumber.CURRENT], bold: true, size: 15, color: '111827' }),
        new TextRun({ text: '|', bold: true, size: 15, color: '111827' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], bold: true, size: 15, color: '111827' }),
      ],
    }),
  ];

  const retrait = (niveau: number) => ({ left: Math.max(0, niveau - 3) * 360 });
  const body: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 120 }, children: [new TextRun({ text: SOUS_TITRE, bold: true, size: 36, color: '111827' })] }),
  ];
  const sousTitre = [opts.projectName, opts.batiment ? libelleBatiment(opts.batiment) : ''].filter(Boolean).join(' · ');
  if (sousTitre) body.push(new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: sousTitre, size: 24, color: '6B7280' })] }));

  for (const b of cctpBlocs(doc, opts.batiment?.id)) {
    const heading = b.niveau === 1 ? HeadingLevel.HEADING_1 : b.niveau === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    const taille = b.niveau === 1 ? 26 : b.niveau === 2 ? 22 : 20;
    body.push(new Paragraph({
      heading, indent: retrait(b.niveau), spacing: { before: b.niveau <= 2 ? 240 : 140, after: 80 },
      children: [new TextRun({ text: `${b.numero}  ${b.titre}`, bold: true, size: taille, color: '111827' })],
    }));
    const mention = (texte: string) => body.push(new Paragraph({
      indent: retrait(b.niveau), spacing: { after: 60 },
      children: [new TextRun({ text: texte, italics: true, size: 17, color: '6B7280' })],
    }));
    if (b.batiments) mention(`Bâtiments concernés : ${b.batiments.join(', ')}`);
    if (b.localisation) mention(`Localisation : ${b.localisation}`);
    for (const para of b.texte.split(/\n/)) {
      if (!para.trim()) continue;
      const puce = /^\s*[-•]\s+/.test(para);
      body.push(new Paragraph({
        indent: retrait(b.niveau), spacing: { after: 80 },
        ...(puce ? { bullet: { level: 0 } } : {}),
        children: [new TextRun({ text: puce ? para.replace(/^\s*[-•]\s+/, '') : para, size: 19, color: '111827' })],
      }));
    }
  }

  const document_ = new Document({
    sections: [{
      properties: {},
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: new Footer({ children: footerChildren }) },
      children: body,
    }],
  });
  const blob = await Packer.toBlob(document_);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = cctpNomFichier(opts, 'docx');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
