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
import { agencyFooterLine, loadLogoDataUrl, type LetterheadOptions } from './pdfLetterhead';

export type Logo = LetterheadOptions['logo'];

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
  title: string;
  subtitle?: string;
  reference?: string;
  colonnes: Colonne[];
  paysage?: boolean;
}

export type Cellule = string | number | null | undefined;

export interface StyleLigne {
  gras?: boolean;
  italique?: boolean;
  fond?: 'groupe' | 'doux';
  /** Fusionne la première cellule sur toute la largeur du tableau. */
  fusionner?: boolean;
}

export interface Feuille {
  ws: Worksheet;
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
export function ajouterFeuille(wb: Workbook, opts: FeuilleOptions): Feuille {
  const { settings, colonnes } = opts;
  const nbCol = Math.max(colonnes.length, 1);
  // Largeur du logo, connue avant la mise en place des colonnes : un tableau
  // trop étroit pour porter logo + coordonnées + titre place le titre dessous.
  const largeurLogo = opts.logo ? Math.round((opts.logo.width / opts.logo.height) * LOGO_HAUTEUR_PX) : 0;
  const largeurAvantTitre = colonnes.slice(0, -1).reduce((t, c) => t + c.width * PX_PAR_CARACTERE, 0);
  const texteSurTitre = nbCol < 3 || largeurAvantTitre < largeurLogo + 160;
  const base = LIGNES_ENTETE + (texteSurTitre ? LIGNES_TITRE_SOUS_ENTETE : 0);
  const ws = wb.addWorksheet(nomOnglet(opts.nom), {
    views: [{ showGridLines: false, state: 'frozen', ySplit: base + 1 }],
  });
  colonnes.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // ── En-tête : logo à gauche, coordonnées à côté, titre à droite ───────────
  let colTexte = 1;
  if (opts.logo) {
    try {
      const id = wb.addImage({ base64: opts.logo.dataUrl, extension: 'png' });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: largeurLogo, height: LOGO_HAUTEUR_PX } });
      // Le texte démarre à la première colonne qui commence après le logo.
      let x = 0;
      colTexte = 0;
      while (colTexte < nbCol && x < largeurLogo + 10) { x += colonnes[colTexte].width * PX_PAR_CARACTERE; colTexte++; }
      colTexte = Math.min(colTexte + 1, nbCol);
    } catch { colTexte = 1; }
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
  const pied = echapperPied(agencyFooterLine(settings)).slice(0, 180);
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
      cell.value = v === undefined || v === null || v === '' ? null : v;
      cell.font = {
        name: 'Calibri', size: 9,
        bold: !!style.gras, italic: !!style.italique,
        color: { argb: entetePlein ? 'FFFFFFFF' : GRIS_TEXTE },
      };
      cell.alignment = { horizontal: col.align ?? 'left', vertical: 'top', wrapText: col.align !== 'right' };
      if (typeof v === 'number' && col.numFmt) cell.numFmt = col.numFmt;
      cell.border = { bottom: { style: 'hair', color: { argb: GRIS_FILET } } };
    });
    return row;
  };

  const peindre = (row: ReturnType<typeof ecrire>, argb: string) => {
    for (let c = 1; c <= nbCol; c++) row.getCell(c).fill = fond(argb);
  };

  return {
    ws,
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
