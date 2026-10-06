// ── Charte du cabinet sur les classeurs Excel ───────────────────────────────
// Reprend la mise en page des PDF (pdfLetterhead.ts) : logo et coordonnées en
// tête, titre du document à droite, tableau en nuances de gris, et à
// l'impression un pied de page avec l'adresse et la pagination « P1|2 ».
//
// SheetJS (xlsx) ne sait ni styler une cellule ni placer une image : ces
// exports passent donc par ExcelJS, chargé à la demande comme jsPDF.
import { saveAs } from 'file-saver';
import type { Workbook, Worksheet, Alignment, Fill } from 'exceljs';
import type { AgencySettings } from './proposalExport';
import { agencyFooterLine, loadLogoDataUrl, resolvePartnerLogos, type LetterheadOptions } from './pdfLetterhead';

export type Logo = LetterheadOptions['logo'];

/** Lignes ajoutées sous l'en-tête pour le bandeau des logos du groupement. */
const LIGNES_LOGOS = 2;
const LOGO_COTRAITANT_HAUTEUR_PX = 34;

// Mêmes gris que le PDF (pdfLetterhead.ts, actExport.ts), en ARGB.
const GRIS_TEXTE = 'FF111827';
const GRIS_DOUX = 'FF6B7280';
const GRIS_FILET = 'FFD1D5DB';
const GRIS_FOND = 'FFF3F4F6';
const GRIS_GROUPE = 'FFE1E1E1';
const GRIS_ENTETE = 'FF3C3C3C';

/** Pixels par unité de largeur de colonne Excel (police par défaut). */
const PX_PAR_CARACTERE = 7;
const LOGO_HAUTEUR_PX = 52;
/** Lignes réservées à l'en-tête avant le tableau : 4 de texte, 1 d'espace. */
const LIGNES_ENTETE = 5;
/** Deux lignes de plus quand le titre ne tient pas à droite (tableau étroit). */
const LIGNES_TITRE_SOUS_ENTETE = 2;

export interface Colonne {
  header: string;
  /** Largeur en caractères. */
  width: number;
  align?: 'left' | 'center' | 'right';
  /** Format de nombre Excel (ex. FORMAT_EURO). */
  numFmt?: string;
}

export const FORMAT_EURO = '#,##0.00" €"';
export const FORMAT_NOMBRE = '#,##0.00';

export interface FeuilleOptions {
  /** Nom de l'onglet (31 caractères maximum, caractères interdits retirés). */
  nom: string;
  settings: AgencySettings;
  logo?: Logo;
  /** Logos des cotraitants ; absent, ceux du groupement actif (resolvePartnerLogos). */
  partnerLogos?: NonNullable<Logo>[];
  title: string;
  subtitle?: string;
  reference?: string;
  colonnes: Colonne[];
  paysage?: boolean;
  /** Lignes de texte sous l'en-tête et avant le tableau (cadre d'un marché, consigne...). */
  infos?: string[];
  /** Onglet masqué (feuille technique lue par un import). */
  masque?: boolean;
}

/** `{ f }` : une formule, pour les classeurs qui doivent rester des calculettes. */
export type Cellule = string | number | null | undefined | { f: string };

export interface StyleLigne {
  gras?: boolean;
  italique?: boolean;
  fond?: 'groupe' | 'doux';
  /** Fusionne la première cellule sur toute la largeur du tableau. */
  fusionner?: boolean;
}

export interface Feuille {
  ws: Worksheet;
  /** Numéro de la ligne d'entête de tableau : les lignes écrites ensuite le suivent une à une. */
  entete: number;
  ligne: (valeurs: Cellule[], style?: StyleLigne) => void;
  /** Ligne de groupe (lot, corps d'état...) : fond gris, texte gras, sur toute la largeur. */
  groupe: (libelle: string) => void;
  /** Ligne de total : fond foncé, texte blanc, comme le pied de tableau du PDF. */
  total: (valeurs: Cellule[]) => void;
  vide: () => void;
}

const nomOnglet = (nom: string) => nom.replace(/[\\/:*?[\]]/g, '_').slice(0, 31) || 'Feuille';

const fond = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** « & » ouvre un code dans les en-têtes et pieds Excel : il faut le doubler. */
const echapperPied = (s: string) => s.replace(/&/g, '&&');

/** Le logo du cabinet, ou null : un logo manquant ne doit jamais empêcher un export. */
export async function chargerLogo(settings: AgencySettings): Promise<Logo> {
  try { return await loadLogoDataUrl(settings.logoUrl); } catch { return null; }
}

export async function nouveauClasseur(): Promise<Workbook> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'ArchiOffice';
  wb.created = new Date();
  return wb;
}

/**
 * Ajoute une feuille avec l'en-tête du cabinet, l'entête de tableau, la mise en
 * page d'impression (A4, largeur ajustée, pied « P1|2 ») et le volet figé sous
 * l'entête de tableau. Les lignes se complètent ensuite par l'objet rendu.
 */
/** Position horizontale (en colonnes, fractionnaire) d'un décalage en pixels depuis le bord gauche. */
function colDepuisPx(largeurs: number[], px: number): number {
  let reste = px;
  for (let i = 0; i < largeurs.length; i++) {
    const larg = largeurs[i] * PX_PAR_CARACTERE;
    if (reste < larg) return i + reste / larg;
    reste -= larg;
  }
  return largeurs.length - 1;
}

export function ajouterFeuille(wb: Workbook, opts: FeuilleOptions): Feuille {
  const { settings, colonnes } = opts;
  const nbCol = Math.max(colonnes.length, 1);
  // ── Géométrie de l'en-tête, calculée avant de poser quoi que ce soit ──────
  // Les cellules n'ont pas de largeur variable : le logo doit tenir à gauche du
  // texte, et le titre (aligné à droite) ne doit pas passer sur le nom du cabinet.
  const largeurs = colonnes.map(c => c.width);
  const largeurLogo = opts.logo ? Math.round((opts.logo.width / opts.logo.height) * LOGO_HAUTEUR_PX) : 0;
  let colTexte = 1; // 1-based : première colonne qui porte le texte du cabinet
  if (opts.logo) {
    let x = 0;
    let idx = 0;
    while (idx < nbCol && x < largeurLogo + 10) { x += largeurs[idx] * PX_PAR_CARACTERE; idx++; }
    // Le logo dépasse toutes les colonnes sauf la dernière : on élargit la première.
    if (idx >= nbCol && nbCol > 1) {
      largeurs[0] = Math.ceil((largeurLogo + 10) / PX_PAR_CARACTERE);
      idx = 1;
    }
    colTexte = Math.min(idx + 1, nbCol);
  }
  const largeurDispo = largeurs.slice(colTexte - 1).reduce((t, w) => t + w * PX_PAR_CARACTERE, 0);
  const largeurNom = (settings.agencyName || '').length * 8.2;
  const largeurTitre = opts.title.length * 8.8;
  const texteSurTitre = nbCol < 2 || colTexte >= nbCol || largeurNom + largeurTitre + 40 > largeurDispo;
  const nbInfos = opts.infos?.length ?? 0;
  const partenaires = resolvePartnerLogos(opts.partnerLogos);
  const lignesLogos = partenaires.length > 0 ? LIGNES_LOGOS : 0;
  const base = LIGNES_ENTETE + (texteSurTitre ? LIGNES_TITRE_SOUS_ENTETE : 0) + nbInfos + lignesLogos;
  const ws = wb.addWorksheet(nomOnglet(opts.nom), {
    state: opts.masque ? 'hidden' : 'visible',
    views: [{ showGridLines: false, state: 'frozen', ySplit: base + 1 }],
  });
  largeurs.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // ── En-tête : logo à gauche, coordonnées à côté, titre à droite ───────────
  if (opts.logo) {
    try {
      const id = wb.addImage({ base64: opts.logo.dataUrl, extension: 'png' });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: largeurLogo, height: LOGO_HAUTEUR_PX } });
    } catch { /* un logo illisible ne doit pas empêcher l'export */ }
  }
  const colTitre = nbCol;

  const cellule = (r: number, c: number, valeur: string, taille: number, gras: boolean, couleur: string, align: Alignment['horizontal'] = 'left') => {
    if (!valeur) return;
    const cell = ws.getCell(r, c);
    cell.value = valeur;
    cell.font = { name: 'Calibri', size: taille, bold: gras, color: { argb: couleur } };
    cell.alignment = { horizontal: align, vertical: 'middle' };
  };

  const contact = [settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  ');
  const droite = [opts.reference, new Date().toLocaleDateString('fr-FR')].filter(Boolean).join('  ·  ');
  cellule(1, colTexte, settings.agencyName || '', 11, true, GRIS_TEXTE);
  cellule(2, colTexte, settings.address || '', 8, false, GRIS_DOUX);
  cellule(3, colTexte, contact, 8, false, GRIS_DOUX);
  if (!texteSurTitre) {
    cellule(1, colTitre, opts.title, 12, true, GRIS_TEXTE, 'right');
    cellule(2, colTitre, opts.subtitle || '', 9, false, GRIS_DOUX, 'right');
    cellule(3, colTitre, droite, 8, false, GRIS_DOUX, 'right');
  } else {
    cellule(LIGNES_ENTETE, 1, opts.title, 12, true, GRIS_TEXTE);
    cellule(LIGNES_ENTETE + 1, 1, [opts.subtitle, droite].filter(Boolean).join('  ·  '), 9, false, GRIS_DOUX);
  }
  ws.getRow(1).height = 20;
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 16;
  ws.getRow(4).height = 8;
  for (let c = 1; c <= nbCol; c++) {
    ws.getCell(4, c).border = { bottom: { style: 'thin', color: { argb: GRIS_FILET } } };
  }
  ws.getRow(LIGNES_ENTETE).height = texteSurTitre ? 20 : 8;
  // Lignes d'information : fusionnées sur la largeur du tableau, en gris doux.
  const premiereInfo = LIGNES_ENTETE + (texteSurTitre ? LIGNES_TITRE_SOUS_ENTETE : 0);
  (opts.infos ?? []).forEach((texte, i) => {
    const r = premiereInfo + i;
    cellule(r, 1, texte, 8, false, GRIS_DOUX);
    if (nbCol > 1) ws.mergeCells(r, 1, r, nbCol);
    ws.getRow(r).height = 14;
  });
  // Bandeau des cotraitants : un libellé, puis les logos côte à côte.
  if (lignesLogos > 0) {
    const rLabel = premiereInfo + nbInfos;
    cellule(rLabel, 1, 'En groupement avec', 7, false, GRIS_DOUX);
    ws.getRow(rLabel).height = 12;
    ws.getRow(rLabel + 1).height = 28;
    let x = 4;
    for (const l of partenaires) {
      let w = Math.round((l.width / l.height) * LOGO_COTRAITANT_HAUTEUR_PX);
      let h = LOGO_COTRAITANT_HAUTEUR_PX;
      if (w > 130) { w = 130; h = Math.round((l.height / l.width) * w); }
      try {
        const imgId = wb.addImage({ base64: l.dataUrl, extension: 'png' });
        ws.addImage(imgId, { tl: { col: colDepuisPx(largeurs, x), row: rLabel }, ext: { width: w, height: h } });
      } catch { /* un logo illisible ne doit pas empêcher l'export */ }
      x += w + 16;
    }
  }
  ws.getRow(base).height = 8;

  // ── Entête du tableau ──────────────────────────────────────────────────────
  const entete = ws.getRow(base + 1);
  colonnes.forEach((col, i) => {
    const cell = entete.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fond(GRIS_ENTETE);
    cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle', wrapText: true };
  });
  entete.height = 20;

  // ── Mise en page d'impression ──────────────────────────────────────────────
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: opts.paysage === false ? 'portrait' : 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.55, right: 0.55, top: 0.6, bottom: 0.75, header: 0.3, footer: 0.35 },
    printTitlesRow: `${base + 1}:${base + 1}`,
  };
  // Le pied d'une feuille Excel tient en 255 caractères : on retire des mentions
  // entières plutôt que de couper la dernière en plein milieu.
  const mentions = agencyFooterLine(settings).split('  ·  ');
  while (mentions.length > 1 && mentions.join('  ·  ').length > 170) mentions.pop();
  const pied = echapperPied(mentions.join('  ·  '));
  ws.headerFooter = {
    oddFooter: `&L&"Calibri,Regular"&7 ${pied}&R&"Calibri,Bold"&8 P&P|&N`,
  };

  // ── Lignes de contenu ──────────────────────────────────────────────────────
  let rang = 0;
  const ecrire = (valeurs: Cellule[], style: StyleLigne = {}, entetePlein = false) => {
    const row = ws.addRow([]);
    colonnes.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      const v = valeurs[i];
      cell.value = v === undefined || v === null || v === '' ? null
        : typeof v === 'object' ? { formula: v.f } : v;
      cell.font = {
        name: 'Calibri', size: 9,
        bold: !!style.gras, italic: !!style.italique,
        color: { argb: entetePlein ? 'FFFFFFFF' : GRIS_TEXTE },
      };
      cell.alignment = { horizontal: col.align ?? 'left', vertical: 'top', wrapText: col.align !== 'right' };
      if ((typeof v === 'number' || typeof v === 'object') && v !== null && col.numFmt) cell.numFmt = col.numFmt;
      cell.border = { bottom: { style: 'hair', color: { argb: GRIS_FILET } } };
    });
    return row;
  };

  const peindre = (row: ReturnType<typeof ecrire>, argb: string) => {
    for (let c = 1; c <= nbCol; c++) row.getCell(c).fill = fond(argb);
  };

  return {
    ws,
    entete: base + 1,
    ligne(valeurs, style = {}) {
      const row = ecrire(valeurs, style);
      if (style.fond === 'groupe') peindre(row, GRIS_GROUPE);
      else if (style.fond === 'doux' || (!style.fond && rang % 2 === 1)) peindre(row, GRIS_FOND);
      if (style.fusionner && nbCol > 1) ws.mergeCells(row.number, 1, row.number, nbCol);
      rang++;
    },
    groupe(libelle) {
      const row = ecrire([libelle.toUpperCase()], { gras: true });
      peindre(row, GRIS_GROUPE);
      if (nbCol > 1) ws.mergeCells(row.number, 1, row.number, nbCol);
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      rang = 0;
    },
    total(valeurs) {
      const row = ecrire(valeurs, { gras: true }, true);
      peindre(row, GRIS_ENTETE);
    },
    vide() { ws.addRow([]); },
  };
}

/** Écrit le classeur et le propose au téléchargement. */
export async function enregistrerClasseur(wb: Workbook, nomFichier: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    nomFichier,
  );
}

export interface ColonneListe extends Colonne {
  /** Clé de la valeur dans chaque ligne. */
  cle: string;
}

/**
 * Export d'une simple liste (annuaire, projets, appels d'offres...) : un
 * classeur à une feuille sous l'en-tête du cabinet. Les lignes rendent leurs
 * valeurs telles quelles, un montant restant un nombre.
 */
export async function exporterListe(opts: {
  fichier: string;
  nom: string;
  title: string;
  subtitle?: string;
  settings: AgencySettings;
  colonnes: ColonneListe[];
  lignes: Record<string, Cellule>[];
  paysage?: boolean;
}): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(opts.settings)]);
  const f = ajouterFeuille(wb, {
    nom: opts.nom, settings: opts.settings, logo,
    title: opts.title, subtitle: opts.subtitle,
    colonnes: opts.colonnes, paysage: opts.paysage,
  });
  for (const ligne of opts.lignes) f.ligne(opts.colonnes.map(c => ligne[c.cle]));
  await enregistrerClasseur(wb, opts.fichier);
}
