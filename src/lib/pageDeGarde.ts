// ── Page de garde des CCTP et DPGF ───────────────────────────────────────────
// Première page du document : l'identité du cabinet en haut, le titre de
// l'opération et du document au milieu, la photo du projet, puis les dates et
// l'indice en bas à droite. Charte sobre : noir, blanc, nuances de gris.
// Partagée par le PDF et le Word ; les pages suivantes portent l'en-tête réduit.
import type { AgencySettings } from './proposalExport';
import { drawPartnerLogos, resolvePartnerLogos, type LogoImage } from './pdfLetterhead';

export interface PhotoCouverture {
  dataUrl: string;
  width: number;
  height: number;
}

/** Ce que l'appelant sait de l'opération, pour la page de garde. */
export interface CouvertureOptions {
  /** Photo du projet (référence de stockage ou URL) ; absente, la page n'a pas de photo. */
  imageUrl?: string;
  adresse?: string;
  maitreOuvrage?: string;
  reference?: string;
}

export interface DonneesPageDeGarde {
  operation: string;
  adresse?: string;
  maitreOuvrage?: string;
  reference?: string;
  /** Intitulé du document : « Cahier des clauses techniques particulières ». */
  intitule: string;
  /** Lot, bâtiment, périmètre ou classement : « Lot 01 GROS-OEUVRE ». */
  precision?: string;
  dateEmission: string;
  dateModification: string;
  indice: string;
  photo?: PhotoCouverture | null;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];

const frDate = (d: Date) => d.toLocaleDateString('fr-FR');

/** Date lisible d'une valeur ISO ; une valeur illisible rend le repli. */
export function dateFr(valeur: string | undefined, repli: Date = new Date()): string {
  const d = valeur ? new Date(valeur) : null;
  return frDate(d && !Number.isNaN(d.getTime()) ? d : repli);
}

/** Données de la page de garde d'un document PRO (CCTP ou DPGF). */
export function donneesPageDeGarde(args: {
  operation?: string;
  titreDocument: string;
  intitule: string;
  precision?: string;
  version: string;
  dateCreation?: string;
  couverture?: CouvertureOptions;
  photo?: PhotoCouverture | null;
}): DonneesPageDeGarde {
  const { couverture } = args;
  return {
    operation: (args.operation || args.titreDocument || '').trim(),
    adresse: couverture?.adresse,
    maitreOuvrage: couverture?.maitreOuvrage,
    reference: couverture?.reference,
    intitule: args.intitule,
    precision: args.precision,
    dateEmission: dateFr(args.dateCreation),
    dateModification: frDate(new Date()),
    indice: args.version,
    photo: args.photo,
  };
}

// ── Photo du projet ──────────────────────────────────────────────────────────
// Chargée une seule fois par URL : un export par lot ou par bâtiment imprime
// la même photo sur chaque fichier. Un échec n'est pas retenu et ne bloque pas.
const photos = new Map<string, Promise<PhotoCouverture | null>>();

export function chargerPhotoCouverture(imageUrl: string | undefined): Promise<PhotoCouverture | null> {
  if (!imageUrl) return Promise.resolve(null);
  let promesse = photos.get(imageUrl);
  if (!promesse) {
    // Chargé à la demande : planRender embarque pdf.js.
    promesse = import('./planRender')
      .then(m => m.loadPhotoDataUrl(imageUrl, 1600))
      .catch(() => null);
    photos.set(imageUrl, promesse);
    void promesse.then(p => { if (!p) photos.delete(imageUrl); });
  }
  return promesse;
}

/** Hauteur réservée en bas de la page de garde au bloc des dates, en mm. */
const BLOC_DATES_MM = 22;

/** Lignes du bloc bas de page : une valeur par ligne, alignées à droite. */
export const lignesDates = (d: DonneesPageDeGarde): string[] => [
  `Date d'émission : ${d.dateEmission}`,
  `Date de modification : ${d.dateModification}`,
  `Indice : ${d.indice}`,
];

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * Dessine la page de garde sur la page courante du PDF (la première). Le pied
 * de page et la pagination sont ajoutés ensuite par drawAgencyFooters.
 */
export function drawPageDeGardePdf(
  pdf: any, settings: AgencySettings, logo: LogoImage | null | undefined, d: DonneesPageDeGarde, margin = 18,
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const largeur = pageW - margin * 2;
  let y = margin;

  // Identité du cabinet.
  let textX = margin;
  if (logo) {
    const h = 16;
    const w = (logo.width / logo.height) * h;
    try {
      pdf.addImage(logo.dataUrl, logo.format, margin, y, w, h);
      textX = margin + w + 5;
    } catch { /* un logo illisible ne doit pas emporter l'export */ }
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(...GRIS_TEXTE);
  pdf.text(settings.agencyName || '', textX, y + 4.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GRIS_DOUX);
  let infoY = y + 9;
  if (settings.address) { pdf.text(settings.address, textX, infoY); infoY += 3.5; }
  const contact = [settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  ');
  if (contact) pdf.text(contact, textX, infoY);
  y += 20;
  pdf.setDrawColor(...GRIS_FILET);
  pdf.setLineWidth(0.4);
  pdf.line(margin, y, pageW - margin, y);
  const bandeau = drawPartnerLogos(pdf, resolvePartnerLogos(), margin, y + 3);
  y = bandeau ?? y;

  // Titre de l'opération et du document.
  y += 22;
  const bloc = (texte: string, taille: number, style: 'bold' | 'normal', couleur: [number, number, number], apres: number) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(taille);
    pdf.setTextColor(...couleur);
    for (const ligne of pdf.splitTextToSize(texte, largeur) as string[]) {
      pdf.text(ligne, margin, y);
      y += taille * 0.45;
    }
    y += apres;
  };
  bloc(d.operation.toUpperCase(), 17, 'bold', GRIS_TEXTE, 3);
  const sousTitre = [d.adresse, d.maitreOuvrage ? `Maître d'ouvrage : ${d.maitreOuvrage}` : '', d.reference ? `Affaire ${d.reference}` : '']
    .filter(Boolean) as string[];
  for (const ligne of sousTitre) bloc(ligne, 10, 'normal', GRIS_DOUX, 0.5);
  y += 6;
  bloc(d.intitule, 14, 'bold', GRIS_TEXTE, 1.5);
  if (d.precision) bloc(d.precision, 11.5, 'normal', GRIS_DOUX, 1);

  // Photo : tout l'espace libre entre le titre et le bloc des dates, rapport conservé.
  const basBloc = pageH - 18 - BLOC_DATES_MM;
  const top = y + 8;
  const dispo = basBloc - 6 - top;
  if (d.photo && dispo > 35) {
    const echelle = Math.min(largeur / d.photo.width, dispo / d.photo.height);
    const w = d.photo.width * echelle;
    const h = d.photo.height * echelle;
    const x = margin + (largeur - w) / 2;
    try {
      pdf.addImage(d.photo.dataUrl, 'JPEG', x, top, w, h);
      pdf.setDrawColor(...GRIS_FILET);
      pdf.setLineWidth(0.25);
      pdf.rect(x, top, w, h);
    } catch { /* une photo illisible ne doit pas emporter l'export */ }
  }

  // Dates et indice, en bas à droite, sous un filet.
  pdf.setDrawColor(...GRIS_TEXTE);
  pdf.setLineWidth(0.3);
  pdf.line(margin, basBloc, pageW - margin, basBloc);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(...GRIS_TEXTE);
  lignesDates(d).forEach((l, i) => pdf.text(l, pageW - margin, basBloc + 6 + i * 5, { align: 'right' }));
}

// ── Word ─────────────────────────────────────────────────────────────────────

/**
 * Paragraphes de la page de garde Word, sous l'en-tête de première page qui
 * porte le logo du cabinet. `largeurMax` et `hauteurMax` bornent la photo (px).
 */
export async function pageDeGardeDocx(
  d: DonneesPageDeGarde, opts: { largeurMax: number; hauteurMax: number },
): Promise<any[]> {
  const { Paragraph, TextRun, ImageRun, AlignmentType, BorderStyle } = await import('docx');
  const gris = '6B7280';
  const noir = '111827';
  const corps: any[] = [];
  const ligne = (texte: string, size: number, o: { bold?: boolean; color?: string; before?: number; after?: number } = {}) =>
    corps.push(new Paragraph({
      spacing: { before: o.before ?? 0, after: o.after ?? 40 },
      children: [new TextRun({ text: texte, size, bold: o.bold, color: o.color ?? noir })],
    }));

  ligne(d.operation.toUpperCase(), 34, { bold: true, before: 1400, after: 80 });
  if (d.adresse) ligne(d.adresse, 20, { color: gris });
  if (d.maitreOuvrage) ligne(`Maître d'ouvrage : ${d.maitreOuvrage}`, 20, { color: gris });
  if (d.reference) ligne(`Affaire ${d.reference}`, 20, { color: gris });
  ligne(d.intitule, 28, { bold: true, before: 360, after: 60 });
  if (d.precision) ligne(d.precision, 23, { color: gris, after: 200 });

  if (d.photo) {
    const echelle = Math.min(opts.largeurMax / d.photo.width, opts.hauteurMax / d.photo.height);
    const data = Uint8Array.from(atob(d.photo.dataUrl.split(',')[1]), c => c.charCodeAt(0));
    corps.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 200, after: 240 },
      children: [new ImageRun({
        type: 'jpg', data,
        transformation: { width: Math.round(d.photo.width * echelle), height: Math.round(d.photo.height * echelle) },
      })],
    }));
  }

  lignesDates(d).forEach((l, i) => corps.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: i === 0 ? 240 : 0, after: 20 },
    border: i === 0 ? { top: { style: BorderStyle.SINGLE, size: 6, color: noir, space: 6 } } : undefined,
    children: [new TextRun({ text: l, size: 19, color: noir })],
  })));
  return corps;
}
