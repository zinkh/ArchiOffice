// ── Charte du cabinet sur les PDF produits depuis l'interface ────────────────
// Un document sorti d'ici part chez un client, une entreprise ou une
// administration : il doit porter l'en-tête et le pied de page du cabinet, pas
// une page blanche anonyme. L'équivalent côté serveur, pour les documents
// fabriqués par un agent, est packages/archioffice-agents/src/server/agencyIdentity.ts.
//
// Extrait de templateExport.ts, qui dessinait la même chose en dur et le fait
// désormais par ici.
import type { AgencySettings } from './proposalExport';

export interface LetterheadOptions {
  /** Titre du document, repris dans le pied de page. */
  title: string;
  subtitle?: string;
  reference?: string;
  margin?: number;
  /** Logo déjà chargé en data URL. Voir loadLogoDataUrl. */
  logo?: { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number } | null;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];

/** Ligne de pied de page : tout ce qui est renseigné, séparé par des points médians. */
export function agencyFooterLine(s: AgencySettings): string {
  return [
    s.agencyName,
    s.address,
    s.phone ? `Tél : ${s.phone}` : '',
    s.email,
    s.siret ? `SIRET ${s.siret}` : '',
    s.oaNumber ? `OA ${s.oaNumber}` : '',
    s.vatNumber ? `TVA ${s.vatNumber}` : '',
  ].filter(Boolean).join('  ·  ');
}

/**
 * Charge le logo du cabinet en data URL, avec ses dimensions réelles — le
 * rapport largeur/hauteur est indispensable pour ne pas le déformer.
 * Rend null en cas d'échec : un logo manquant ne doit jamais empêcher un export.
 */
export async function loadLogoDataUrl(
  logoUrl?: string,
): Promise<LetterheadOptions['logo']> {
  if (!logoUrl) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = logoUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      format: 'PNG',
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } catch {
    return null;
  }
}

/**
 * Dessine l'en-tête sur la page courante et rend l'ordonnée où le contenu peut
 * commencer.
 */
export function drawAgencyHeader(
  pdf: any, settings: AgencySettings, opts: LetterheadOptions,
): number {
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = opts.margin ?? 14;
  let y = margin;

  // Logo à gauche, hauteur bornée, rapport conservé.
  let textX = margin;
  if (opts.logo) {
    const hMax = 14;
    const h = hMax;
    const w = (opts.logo.width / opts.logo.height) * h;
    try {
      pdf.addImage(opts.logo.dataUrl, opts.logo.format, margin, y, w, h);
      textX = margin + w + 5;
    } catch { /* un logo illisible ne doit pas emporter l'export */ }
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...GRIS_TEXTE);
  pdf.text(settings.agencyName || '', textX, y + 4.5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GRIS_DOUX);
  let infoY = y + 9;
  if (settings.address) { pdf.text(settings.address, textX, infoY); infoY += 3.5; }
  const contact = [settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  ');
  if (contact) { pdf.text(contact, textX, infoY); infoY += 3.5; }

  // Titre du document, à droite.
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(...GRIS_TEXTE);
  pdf.text(opts.title, pageW - margin, y + 4.5, { align: 'right' });
  if (opts.subtitle) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GRIS_DOUX);
    pdf.text(opts.subtitle, pageW - margin, y + 9.5, { align: 'right' });
  }
  const droite = [opts.reference, new Date().toLocaleDateString('fr-FR')].filter(Boolean).join('  ·  ');
  if (droite) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GRIS_DOUX);
    pdf.text(droite, pageW - margin, y + 14, { align: 'right' });
  }

  y = Math.max(infoY, y + 16);
  pdf.setDrawColor(...GRIS_FILET);
  pdf.setLineWidth(0.4);
  pdf.line(margin, y, pageW - margin, y);
  return y + 5;
}

/**
 * Dessine le pied de page sur TOUTES les pages. À appeler une fois le contenu
 * terminé, quand le nombre de pages est connu.
 *
 * La pagination est au format « P1|2 », en bas à droite : c'est la convention
 * de numérotation du cabinet, la même que celle des documents produits par les
 * agents (packages/archioffice-agents/src/server/artifacts.ts).
 */
export function drawAgencyFooters(pdf: any, settings: AgencySettings, opts: LetterheadOptions): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = opts.margin ?? 14;
  const total = pdf.internal.getNumberOfPages();
  const ligne = agencyFooterLine(settings);

  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...GRIS_FILET);
    pdf.setLineWidth(0.25);
    pdf.line(margin, pageH - 11, pageW - margin, pageH - 11);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(...GRIS_DOUX);
    // Le pied peut être long : on le tronque plutôt que de le laisser
    // chevaucher la pagination.
    const dispo = pageW - margin * 2 - 20;
    const [premiere] = pdf.splitTextToSize(ligne, dispo) as string[];
    pdf.text(premiere ?? '', margin, pageH - 7);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GRIS_TEXTE);
    pdf.text(`P${p}|${total}`, pageW - margin, pageH - 7, { align: 'right' });
  }
}
