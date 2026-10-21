// ── Charte du cabinet sur les PDF produits depuis l'interface ────────────────
// Un document sorti d'ici part chez un client, une entreprise ou une
// administration : il doit porter l'en-tête et le pied de page du cabinet, pas
// une page blanche anonyme. L'équivalent côté serveur, pour les documents
// fabriqués par un agent, est packages/archioffice-agents/src/server/agencyIdentity.ts.
//
// Extrait de templateExport.ts, qui dessinait la même chose en dur et le fait
// désormais par ici.
import type { AgencySettings } from './proposalExport';

export interface LogoImage {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

export interface LetterheadOptions {
  /** Titre du document, repris dans le pied de page. */
  title: string;
  subtitle?: string;
  reference?: string;
  /** Date imprimée sous le titre (date du document) ; à défaut, celle du jour. */
  date?: string;
  margin?: number;
  /** Logo déjà chargé en data URL. Voir loadLogoDataUrl. */
  logo?: LogoImage | null;
  /**
   * Logos des cotraitants du groupement, déjà chargés (voir loadCotraitantLogos).
   * Ils s'impriment en bandeau sous l'en-tête du cabinet, sur chaque page.
   * Absent : le groupement actif de l'écran (voir resolvePartnerLogos) ;
   * liste vide : l'en-tête reste celui du cabinet seul.
   */
  partnerLogos?: LogoImage[];
}

// ── Groupement actif ─────────────────────────────────────────────────────────
// Les logos des cotraitants doivent figurer sur TOUS les documents d'une
// affaire (PDF, Word, Excel) sans que chaque export ait à recevoir le
// groupement : l'écran qui travaille sur une affaire déclare son groupement
// (useActiveGroupement), et chaque en-tête le lit ici. Une option explicite
// `partnerLogos` l'emporte (liste vide pour s'en passer). Hors d'une affaire,
// ou côté serveur, le registre est vide : aucun logo.
let groupementActif: LogoImage[] = [];

export function setActiveGroupementLogos(logos: LogoImage[]): void {
  groupementActif = logos;
}

/** Logos à imprimer : ceux passés explicitement, à défaut ceux du groupement actif. */
export function resolvePartnerLogos(explicit?: LogoImage[]): LogoImage[] {
  return explicit ?? groupementActif;
}

/** Hauteur du bandeau de logos des cotraitants, en mm. */
const PARTNER_LOGO_HEIGHT = 9;
const PARTNER_LOGO_GAP = 7;
const PARTNER_LOGO_MAX_WIDTH = 34;

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
): Promise<LogoImage | null> {
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

// ── En-tête des pages suivantes ──────────────────────────────────────────────
// Règle de la charte : le logo, les coordonnées et les logos des cotraitants ne
// figurent que sur la PREMIÈRE page. Les pages suivantes portent un en-tête
// d'une seule ligne : le nom de l'agence en texte à gauche, le nom du document
// à droite. drawAgencyHeader() applique la règle seul (appelé sur une page
// au-delà de la première, il dessine cette ligne) et drawAgencyFooters()
// complète les pages qui n'ont reçu aucun en-tête.

/** Pages (par document jsPDF) qui portent déjà un en-tête, complet ou réduit. */
const pagesAvecEntete = new WeakMap<object, Set<number>>();

const pageCourante = (pdf: any): number =>
  pdf.internal?.getCurrentPageInfo?.()?.pageNumber ?? 1;

const marquerEntete = (pdf: any, page: number) => {
  const pages = pagesAvecEntete.get(pdf) ?? new Set<number>();
  pages.add(page);
  pagesAvecEntete.set(pdf, pages);
};

/** Ordonnée où le contenu d'une page réduite peut commencer. */
export const ENTETE_REDUIT_BAS = 16;

/**
 * En-tête d'une seule ligne : agence à gauche, document à droite, filet fin.
 * Rend l'ordonnée où le contenu peut commencer.
 */
export function drawCompactHeader(
  pdf: any, settings: AgencySettings, opts: Pick<LetterheadOptions, 'title' | 'subtitle' | 'margin'>,
): number {
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = opts.margin ?? 14;
  const base = 8;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...GRIS_TEXTE);
  const agence = settings.agencyName || '';
  pdf.text(agence, margin, base);

  const placeDroite = pageW - margin * 2 - pdf.getTextWidth(agence) - 8;
  const document = [opts.title, opts.subtitle].filter(Boolean).join('  |  ');
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...GRIS_DOUX);
  const [ligne] = pdf.splitTextToSize(document, Math.max(placeDroite, 20)) as string[];
  pdf.text(ligne ?? '', pageW - margin, base, { align: 'right' });

  pdf.setDrawColor(...GRIS_FILET);
  pdf.setLineWidth(0.25);
  pdf.line(margin, base + 2.5, pageW - margin, base + 2.5);
  marquerEntete(pdf, pageCourante(pdf));
  return Math.max(ENTETE_REDUIT_BAS, margin + 2);
}

/**
 * Dessine l'en-tête sur la page courante et rend l'ordonnée où le contenu peut
 * commencer. Première page : logo, coordonnées, titre. Pages suivantes : la
 * ligne réduite (voir plus haut), jamais le logo.
 */
export function drawAgencyHeader(
  pdf: any, settings: AgencySettings, opts: LetterheadOptions,
): number {
  if (pageCourante(pdf) > 1) return drawCompactHeader(pdf, settings, opts);
  marquerEntete(pdf, 1);
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
  const droite = [opts.reference, opts.date || new Date().toLocaleDateString('fr-FR')].filter(Boolean).join('  ·  ');
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

  const bandeauBas = drawPartnerLogos(pdf, resolvePartnerLogos(opts.partnerLogos), margin, y + 3);
  if (bandeauBas !== null) {
    pdf.setLineWidth(0.25);
    pdf.line(margin, bandeauBas, pageW - margin, bandeauBas);
    return bandeauBas + 5;
  }
  return y + 5;
}

/**
 * Bandeau « en groupement avec » : les logos des cotraitants, alignés à gauche
 * sous l'en-tête du cabinet, hauteur commune, rapport conservé. Rend l'ordonnée
 * du bas du bandeau, ou null quand il n'y a rien à dessiner.
 */
export function drawPartnerLogos(
  pdf: any, logos: LogoImage[] | undefined, margin: number, top: number,
): number | null {
  if (!logos || logos.length === 0) return null;
  const pageW = pdf.internal.pageSize.getWidth();

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(...GRIS_DOUX);
  pdf.text('En groupement avec', margin, top + 2);

  let x = margin;
  const logoTop = top + 4;
  for (const logo of logos) {
    // Un logo très large est réduit en largeur plutôt que de pousser les autres.
    let h = PARTNER_LOGO_HEIGHT;
    let w = (logo.width / logo.height) * h;
    if (w > PARTNER_LOGO_MAX_WIDTH) {
      w = PARTNER_LOGO_MAX_WIDTH;
      h = (logo.height / logo.width) * w;
    }
    if (x + w > pageW - margin) break;
    try {
      pdf.addImage(logo.dataUrl, logo.format, x, logoTop + (PARTNER_LOGO_HEIGHT - h) / 2, w, h);
    } catch { /* un logo illisible ne doit pas emporter l'export */ }
    x += w + PARTNER_LOGO_GAP;
  }
  return logoTop + PARTNER_LOGO_HEIGHT + 2;
}

/** Membre d'un groupement référencé par sa fiche contact. */
export interface GroupementMember {
  contact_id?: string;
}

/**
 * Logos des cotraitants d'un document, dans l'ordre du groupement, sans doublon.
 * Un cotraitant sans fiche contact, ou dont la fiche n'a pas de logo, est
 * simplement ignoré : un logo manquant ne doit jamais empêcher un export.
 */
export async function loadCotraitantLogos(
  members: GroupementMember[] | undefined | null,
): Promise<LogoImage[]> {
  const ids = [...new Set((members ?? []).map(m => m.contact_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  try {
    const r = await fetch('/api/contacts');
    if (!r.ok) return [];
    const contacts = (await r.json()) as Array<{ id: string; logo?: string | null }>;
    const parId = new Map(contacts.map(c => [c.id, c.logo || '']));
    const loaded = await Promise.all(ids.map(id => loadLogoDataUrl(parId.get(id) || undefined)));
    return loaded.filter((l): l is LogoImage => l !== null);
  } catch {
    return [];
  }
}

// ── Identité d'un cotraitant ─────────────────────────────────────────────────

/** Ce qu'on imprime d'un cotraitant : de quoi l'identifier et le joindre. */
export interface CotraitantIdentity {
  contactId: string;
  /** Raison sociale, à défaut le nom de la personne. */
  titre: string;
  /** La personne, quand la raison sociale occupe déjà le titre. */
  sousTitre: string;
  adresse: string;
  telephone: string;
  email: string;
  siret: string;
  logo: LogoImage | null;
}

/** Champs de la fiche contact dont l'identité est tirée (réponse de GET /api/contacts). */
export interface ContactIdentitySource {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  email?: string | null;
  email_work?: string | null;
  phone?: string | null;
  phone_work?: string | null;
  phone_main?: string | null;
  phone_mobile?: string | null;
  address?: string | null;
  zip?: string | null;
  city?: string | null;
  address_work_street?: string | null;
  address_work_zip?: string | null;
  address_work_city?: string | null;
  siret?: string | null;
  logo?: string | null;
}

const texte = (value: string | null | undefined): string => (value ?? '').trim();

/** Identité imprimable d'une fiche contact. Rien n'est inventé : un champ vide reste vide. */
export function identityFromContact(c: ContactIdentitySource): Omit<CotraitantIdentity, 'logo'> {
  const personne = [texte(c.first_name), texte(c.last_name)].filter(Boolean).join(' ');
  const societe = texte(c.company_name);

  const rue = texte(c.address_work_street) || texte(c.address);
  const ville = [texte(c.address_work_zip) || texte(c.zip), texte(c.address_work_city) || texte(c.city)]
    .filter(Boolean).join(' ');

  return {
    contactId: c.id,
    titre: societe || personne,
    sousTitre: societe ? [personne, texte(c.job_title)].filter(Boolean).join(', ') : texte(c.job_title),
    adresse: [rue, ville].filter(Boolean).join(', '),
    telephone: texte(c.phone_work) || texte(c.phone_main) || texte(c.phone_mobile) || texte(c.phone),
    email: texte(c.email_work) || texte(c.email),
    siret: texte(c.siret),
  };
}

/**
 * Identités (raison sociale, coordonnées, SIRET, logo) des cotraitants d'un
 * document, dans l'ordre du groupement, sans doublon. Comme pour les logos seuls,
 * un échec réseau ne doit jamais empêcher un export : la liste est alors vide.
 */
export async function loadCotraitantIdentities(
  members: GroupementMember[] | undefined | null,
): Promise<CotraitantIdentity[]> {
  const ids = [...new Set((members ?? []).map(m => m.contact_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  try {
    const r = await fetch('/api/contacts');
    if (!r.ok) return [];
    const contacts = (await r.json()) as ContactIdentitySource[];
    const parId = new Map(contacts.map(c => [c.id, c]));
    return await Promise.all(ids.flatMap(id => {
      const contact = parId.get(id);
      if (!contact) return [];
      return [loadLogoDataUrl(contact.logo || undefined).then(logo => ({ ...identityFromContact(contact), logo }))];
    }));
  } catch {
    return [];
  }
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
    if (p > 1 && !pagesAvecEntete.get(pdf)?.has(p)) drawCompactHeader(pdf, settings, opts);
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

// ── Tableaux : nuances de gris, comme le reste de la charte ───────────────────
// Partagés par les PDF qui passaient jusqu'ici par un bleu propre à chacun.

export const TABLEAU_GRIS = {
  entete: [60, 60, 60] as [number, number, number],
  groupe: [225, 225, 225] as [number, number, number],
  sousGroupe: [240, 240, 240] as [number, number, number],
  alterne: [243, 244, 246] as [number, number, number],
  texte: GRIS_TEXTE,
};

/** Options autoTable communes : entête gris foncé, lignes alternées, pied de page libre en bas. */
export function tableauGris(margin = 14): Record<string, any> {
  return {
    margin: { left: margin, right: margin, top: 17, bottom: 18 },
    styles: { fontSize: 8, textColor: TABLEAU_GRIS.texte, cellPadding: 2 },
    headStyles: { fillColor: TABLEAU_GRIS.entete, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: TABLEAU_GRIS.alterne },
    footStyles: { fillColor: TABLEAU_GRIS.entete, textColor: 255, fontStyle: 'bold' },
  };
}

/**
 * Réglages du cabinet pour un PDF produit hors d'un composant qui les a déjà
 * (générateurs au niveau d'un module). Meilleur effort : sans réponse, le
 * document part avec un en-tête vide plutôt que de ne pas partir.
 */
export async function fetchAgencySettings(): Promise<AgencySettings> {
  try {
    const r = await fetch('/api/settings');
    return r.ok ? ((await r.json()) ?? {}) : {};
  } catch {
    return {};
  }
}
