import { DPGF, Lot, Chapitre, Ligne, GroupementDpgf, LIBELLES_GROUPEMENT, NATURES_HORS_BASE, type NatureArticle } from '../types/dpgf';
import { grouperDpgf } from './dpgfGrouping';
import { formatQuantite } from './quantiteFormat';
import { sousTotalNature } from '../components/pro/treeOps';
import type { AgencySettings } from './proposalExport';
import { enregistrerPdf, type Sortie } from './exportSortie';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO, FORMAT_NOMBRE, FORMAT_QUANTITE,
} from './xlsxLetterhead';

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const LIBELLE_NATURE = { pse: 'PSE', option: 'Option', variante: 'Variante' } as const;
const LIBELLE_TOTAL_NATURE = {
  pse: 'PSE HT, non comprises dans le total',
  option: 'Options HT, non comprises dans le total',
  variante: 'Variantes HT, non comprises dans le total',
} as const;

/** Repère imprimé après la désignation : PSE, option, variante ou pour mémoire. */
const repereStatut = (pourMemoire?: boolean, nature?: NatureArticle) =>
  [nature && nature !== 'base' ? LIBELLE_NATURE[nature] : '', pourMemoire ? 'PM' : '']
    .filter(Boolean).map(r => ` (${r})`).join('');

/** Totaux hors base d'un document (PSE, options, variantes), seulement les non nuls. */
const totauxHorsBase = (dpgf: DPGF): { libelle: string; total: number }[] =>
  NATURES_HORS_BASE
    .map(n => ({ libelle: LIBELLE_TOTAL_NATURE[n], total: dpgf.lots.reduce((s, l) => s + sousTotalNature(l, n), 0) }))
    .filter(t => t.total);

/** Lignes de pied « Options (PSE) » et « Variantes », seulement s'il y en a. */
function piedHorsBase(dpgf: DPGF, colonnes: number, format: (n: number) => string, extra = 0): string[][] {
  return totauxHorsBase(dpgf).map(t => ['', t.libelle, ...Array(colonnes - 3).fill(''), format(t.total) + ' €', ...Array(extra).fill('')]);
}

/** Pied Excel des options et variantes, en nombres (pas de texte formaté). */
function ajouterHorsBase(f: { ligne: (valeurs: (string | number | undefined)[], style?: { gras?: boolean }) => void }, dpgf: DPGF, colonnes: number, extra = 0) {
  for (const t of totauxHorsBase(dpgf)) f.ligne(['', t.libelle, ...Array(colonnes - 3).fill(''), t.total, ...Array(extra).fill('')], { gras: true });
}

/** Taux affiché sans décimale inutile : « 10 », « 5,5 ». */
const fmtTaux = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n);

/** TVA d'un poste qui porte un taux dédié ; `undefined` pour les autres et les postes pour mémoire. */
const tvaDuPoste = (taux: number | undefined, total: number, pm: boolean): number | undefined =>
  taux == null || !Number.isFinite(taux) || pm ? undefined : total * taux / 100;

/** Une ligne de calcul par taux : base HT des postes concernés et TVA correspondante. */
interface VentilationTva { taux: number; base: number; montant: number }

/** Ventile par taux les postes à taux dédié (lots et chapitres n'en portent pas), taux croissants. */
function ventilerTva(rows: { total: number; tvaTaux?: number; tvaMontant?: number }[]): VentilationTva[] {
  const parTaux = new Map<number, VentilationTva>();
  for (const r of rows) {
    if (r.tvaTaux == null || r.tvaMontant == null) continue;
    const v = parTaux.get(r.tvaTaux) ?? { taux: r.tvaTaux, base: 0, montant: 0 };
    v.base += r.total;
    v.montant += r.tvaMontant;
    parTaux.set(r.tvaTaux, v);
  }
  return [...parTaux.values()].sort((a, b) => a.taux - b.taux);
}

const libelleTva = (v: VentilationTva) => `TVA ${fmtTaux(v.taux)} % sur ${fmt(v.base)} € HT`;
const sommeMontants = (vs: VentilationTva[]) => vs.reduce((s, v) => s + v.montant, 0);

/** Pied PDF : une ligne par taux, puis le total s'il y a plusieurs taux. `colonnes` = colonnes sans la TVA. */
function piedTvaPdf(rows: Parameters<typeof ventilerTva>[0], colonnes: number): string[][] {
  const vs = ventilerTva(rows);
  const vide = Array(colonnes - 3).fill('');
  const lignes = vs.map(v => ['', libelleTva(v), ...vide, '', fmt(v.montant) + ' €']);
  return vs.length > 1 ? [...lignes, ['', 'TOTAL TVA dédiée', ...vide, '', fmt(sommeMontants(vs)) + ' €']] : lignes;
}

/** Pied Excel : base, taux et montant en nombres, une ligne par taux puis le total s'il y en a plusieurs. */
function ajouterPiedTvaExcel(
  f: { ligne: (valeurs: (string | number | undefined)[], style?: { gras?: boolean }) => void },
  rows: Parameters<typeof ventilerTva>[0], colonnes: number,
) {
  const vs = ventilerTva(rows);
  const vide = Array(colonnes - 3).fill('');
  for (const v of vs) f.ligne(['', `TVA ${fmtTaux(v.taux)} %`, ...vide, v.base, v.taux, v.montant], { gras: true });
  if (vs.length > 1) f.ligne(['', 'TOTAL TVA dédiée', ...vide, '', '', sommeMontants(vs)], { gras: true });
}

/** Taux dédié et TVA correspondante d'une ligne, à étaler dans la ligne aplatie. */
const tvaDeLigne = (l: Ligne): { tvaTaux?: number; tvaMontant?: number } => {
  const tvaMontant = tvaDuPoste(l.tva, l.prixTotal, !!l.pourMemoire);
  return tvaMontant === undefined ? {} : { tvaTaux: l.tva, tvaMontant };
};

/** Cellule PDF :« 23,40 (10 %) », vide pour un poste sans taux dédié. */
const celluleTva = (taux?: number, montant?: number) =>
  taux == null || montant == null ? '' : `${fmt(montant)} (${fmtTaux(taux)} %)`;

/**
 * Aplatit un DPGF classé par bâtiment/phase (jamais par lot : l'arbre par lot
 * a déjà flattenDPGF, qui garde la hiérarchie lot > chapitre > article que ce
 * classement-ci n'a pas). Même groupement que l'écran (DpgfGroupedView), pour
 * que le document remis au client corresponde à ce que l'architecte a
 * vérifié — un export figé sur « par lot » quel que soit le classement choisi
 * à l'écran serait trompeur.
 */
function flattenDPGFGroupe(dpgf: DPGF, groupement: Exclude<GroupementDpgf, 'lot'>): Array<{
  type: 'groupe' | 'article';
  numero: string;
  designation: string;
  lot: string;
  localisation: string;
  unite: string;
  quantite: string;
  prixUnitaire: string;
  prixTotal: string;
  /** Valeurs brutes, pour l'Excel : un montant doit y rester un nombre. */
  q: number;
  pu: number;
  total: number;
  pm: boolean;
  tvaTaux?: number;
  tvaMontant?: number;
}> {
  const rows: ReturnType<typeof flattenDPGFGroupe> = [];
  for (const [, g] of grouperDpgf(dpgf, groupement)) {
    rows.push({ type: 'groupe', numero: '', designation: g.libelle, lot: '', localisation: '', unite: '', quantite: '', prixUnitaire: '', prixTotal: fmt(g.total), q: 0, pu: 0, total: g.total, pm: false });
    for (const a of g.articles) {
      rows.push({
        type: 'article',
        numero: a.ligne.numero,
        designation: a.ligne.designation + repereStatut(a.ligne.pourMemoire, a.nature),
        lot: `${a.lot.numero} ${a.lot.titre}`,
        localisation: a.ligne.localisation || '',
        unite: a.ligne.unite,
        quantite: a.ligne.quantite > 0 ? formatQuantite(a.ligne.quantite) : '',
        prixUnitaire: a.ligne.pourMemoire ? 'PM' : a.ligne.prixUnitaire > 0 ? fmt(a.ligne.prixUnitaire) : '',
        prixTotal: a.ligne.pourMemoire ? 'PM' : a.ligne.prixTotal > 0 ? fmt(a.ligne.prixTotal) : '',
        q: a.ligne.quantite, pu: a.ligne.prixUnitaire, total: a.ligne.prixTotal, pm: !!a.ligne.pourMemoire,
        ...tvaDeLigne(a.ligne),
      });
    }
  }
  return rows;
}

function flattenDPGF(lots: Lot[]): Array<{
  depth: number;
  numero: string;
  designation: string;
  unite: string;
  quantite: string;
  prixUnitaire: string;
  prixTotal: string;
  type: string;
  q: number;
  pu: number;
  total: number;
  pm: boolean;
  tvaTaux?: number;
  tvaMontant?: number;
}> {
  const rows: ReturnType<typeof flattenDPGF> = [];
  for (const lot of lots) {
    rows.push({ depth: 0, numero: lot.numero, designation: lot.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: fmt(lot.sousTotal), type: 'lot', q: 0, pu: 0, total: lot.sousTotal, pm: false });
    for (const chap of lot.chapitres) {
      rows.push({ depth: 1, numero: chap.numero, designation: chap.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: '', type: 'chapitre', q: 0, pu: 0, total: 0, pm: false });
      // Descend dans les sous-articles : la version précédente s'arrêtait au
      // premier niveau et faisait disparaître silencieusement tout ce qui se
      // trouvait en dessous de chaque export PDF ou Excel.
      const walk = (lignes: Ligne[], depth: number) => {
        for (const ligne of lignes) {
          rows.push({
            depth,
            numero: ligne.numero,
            designation: ligne.designation + repereStatut(ligne.pourMemoire, ligne.nature),
            unite: ligne.unite,
            quantite: ligne.quantite > 0 ? formatQuantite(ligne.quantite) : '',
            prixUnitaire: ligne.pourMemoire ? 'PM' : ligne.prixUnitaire > 0 ? fmt(ligne.prixUnitaire) : '',
            prixTotal: ligne.pourMemoire ? 'PM' : ligne.prixTotal > 0 ? fmt(ligne.prixTotal) : '',
            type: ligne.type,
            q: ligne.quantite, pu: ligne.prixUnitaire, total: ligne.prixTotal, pm: !!ligne.pourMemoire,
            ...tvaDeLigne(ligne),
          });
          if (ligne.children?.length) walk(ligne.children, depth + 1);
        }
      };
      walk(chap.lignes, 2);
    }
  }
  return rows;
}

// ── DPGF PDF ─────────────────────────────────────────────────────────────────

export interface ExportDpgfOptions {
  /**
   * Par défaut le DPGF exporté est SANS PRIX : il sert de cadre de réponse aux
   * entreprises. Les colonnes « P.U. HT (€) » et « Total HT (€) » restent
   * présentes mais VIDES, pour que l'entreprise les remplisse et que le fichier
   * revienne dans l'atelier ACT (import d'offre). `avecPrix` les remplit et
   * ajoute les totaux : usage interne.
   */
  avecPrix?: boolean;
  /**
   * Ajoute la colonne « TVA » : montant de TVA des seuls postes qui portent un
   * taux dédié (`Ligne.tva`). Masquée par défaut ; sans effet hors `avecPrix`.
   */
  avecTva?: boolean;
  /** Destination du fichier ; absente, il est téléchargé. */
  sortie?: Sortie;
}

export async function exportDPGFtoPDF(
  dpgf: DPGF, projectName?: string, groupement: GroupementDpgf = 'lot', settings: AgencySettings = {},
  { avecPrix = false, avecTva = false, sortie }: ExportDpgfOptions = {},
) {
  const colTva = avecPrix && avecTva;
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const classement = groupement !== 'lot' ? ` — Classement : ${LIBELLES_GROUPEMENT[groupement]}` : '';
  const letterhead = {
    title: 'DPGF — Décomposition du Prix Global et Forfaitaire',
    subtitle: projectName,
    reference: `v${dpgf.version}${classement}`,
    margin: 14, logo,
  };
  const startY = drawAgencyHeader(doc, settings, letterhead);

  if (groupement === 'lot') {
    const rows = flattenDPGF(dpgf.lots);
    autoTable(doc, {
      ...tableauGris(),
      startY,
      head: [['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)', ...(colTva ? ['TVA dédiée (€)'] : [])]],
      body: rows.map(r => {
        const debut = [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, r.quantite];
        // Sans prix, P.U. et Total restent des cases vides à remplir par l'entreprise.
        return [...debut, avecPrix ? r.prixUnitaire : '', avecPrix ? r.prixTotal : '',
          ...(colTva ? [celluleTva(r.tvaTaux, r.tvaMontant)] : [])];
      }),
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 28, halign: 'right' },
        5: { cellWidth: 28, halign: 'right' },
        ...(colTva ? { 6: { cellWidth: 36, halign: 'right' } } : {}),
      },
      didParseCell: (data: any) => {
        const row = rows[data.row.index];
        if (!row || data.section !== 'body') return;
        if (row.type === 'lot') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = TABLEAU_GRIS.groupe;
        } else if (row.type === 'chapitre') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = TABLEAU_GRIS.sousGroupe;
        } else if (row.type === 'titre') {
          data.cell.styles.fontStyle = 'italic';
        }
      },
      ...(avecPrix ? { foot: [
        ['', 'TOTAL HT', '', '', '', fmt(dpgf.totalHT) + ' €', ...(colTva ? [''] : [])],
        ...piedHorsBase(dpgf, 6, fmt, colTva ? 1 : 0),
        ...(colTva ? piedTvaPdf(rows, 6) : []),
      ] } : {}),
    });
  } else {
    const rows = flattenDPGFGroupe(dpgf, groupement);
    autoTable(doc, {
      ...tableauGris(),
      startY,
      head: [['N°', 'Désignation', 'Lot', 'Localisation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)', ...(colTva ? ['TVA dédiée (€)'] : [])]],
      body: rows.map(r => {
        const debut = [r.numero, r.designation, r.lot, r.localisation, r.unite, r.quantite];
        return [...debut, avecPrix ? r.prixUnitaire : '', avecPrix ? r.prixTotal : '',
          ...(colTva ? [celluleTva(r.tvaTaux, r.tvaMontant)] : [])];
      }),
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 32 },
        3: { cellWidth: 26 },
        4: { cellWidth: 16, halign: 'center' },
        5: { cellWidth: 20, halign: 'right' },
        6: { cellWidth: 26, halign: 'right' },
        7: { cellWidth: 28, halign: 'right' },
        ...(colTva ? { 8: { cellWidth: 36, halign: 'right' } } : {}),
      },
      didParseCell: (data: any) => {
        const row = rows[data.row.index];
        if (row?.type === 'groupe' && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = TABLEAU_GRIS.groupe;
        }
      },
      ...(avecPrix ? { foot: [
        ['', 'TOTAL HT', '', '', '', '', '', fmt(dpgf.totalHT) + ' €', ...(colTva ? [''] : [])],
        ...piedHorsBase(dpgf, 8, fmt, colTva ? 1 : 0),
        ...(colTva ? piedTvaPdf(rows, 8) : []),
      ] } : {}),
    });
  }

  drawAgencyFooters(doc, settings, letterhead);
  await enregistrerPdf(doc, `DPGF_${dpgf.titre.replace(/\s+/g, '_')}.pdf`, sortie);
}

// ── Estimation PDF ────────────────────────────────────────────────────────────

export async function exportEstimationtoPDF(dpgf: DPGF, projectName?: string, settings: AgencySettings = {}, sortie?: Sortie) {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const letterhead = { title: 'ESTIMATION — Récapitulatif par lot', subtitle: projectName, margin: 14, logo };
  const startY = drawAgencyHeader(doc, settings, letterhead);

  autoTable(doc, {
    ...tableauGris(),
    startY,
    head: [['N°', 'Lot', 'Montant HT', 'Montant TTC']],
    body: dpgf.lots.map(lot => [
      lot.numero,
      lot.titre,
      fmt(lot.sousTotal) + ' €',
      fmt(lot.sousTotal * (1 + dpgf.TVA / 100)) + ' €',
    ]),
    styles: { fontSize: 9, textColor: TABLEAU_GRIS.texte, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
    foot: [['', 'TOTAL', fmt(dpgf.totalHT) + ' €', fmt(dpgf.totalTTC) + ' €']],
  });

  const finalY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TABLEAU_GRIS.texte);
  doc.text(`TVA ${dpgf.TVA}% : ${fmt(dpgf.totalTTC - dpgf.totalHT)} €`, 14, finalY);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total TTC : ${fmt(dpgf.totalTTC)} €`, 14, finalY + 6);
  doc.setFont('helvetica', 'normal');
  totauxHorsBase(dpgf).forEach((t, i) => {
    doc.text(`${t.libelle} : ${fmt(t.total)} € (TTC ${fmt(t.total * (1 + dpgf.TVA / 100))} €)`, 14, finalY + 14 + i * 6);
  });

  drawAgencyFooters(doc, settings, letterhead);
  await enregistrerPdf(doc, `Estimation_${dpgf.titre.replace(/\s+/g, '_')}.pdf`, sortie);
}

// ── DPGF Excel ────────────────────────────────────────────────────────────────

export async function exportDPGFtoExcel(
  dpgf: DPGF, projectName?: string, groupement: GroupementDpgf = 'lot', settings: AgencySettings = {},
  { avecPrix = false, avecTva = false, sortie }: ExportDpgfOptions = {},
) {
  const colTva = avecPrix && avecTva;
  // Colonnes TVA : le taux dédié du poste, puis son montant (un nombre dans la cellule).
  const entetesTva = colTva ? [
    { header: 'Taux TVA dédié (%)', width: 14, align: 'right' as const, numFmt: FORMAT_QUANTITE },
    { header: 'TVA dédiée (€)', width: 15, align: 'right' as const, numFmt: FORMAT_NOMBRE },
  ] : [];
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const classement = groupement !== 'lot' ? ` — Classement : ${LIBELLES_GROUPEMENT[groupement]}` : '';
  const commun = {
    nom: 'DPGF', settings, logo,
    title: 'DPGF — Décomposition du Prix Global et Forfaitaire',
    subtitle: projectName || dpgf.titre,
    reference: `v${dpgf.version}${classement}`,
  };
  const nombre = (n: number) => (n > 0 ? n : undefined);

  if (groupement === 'lot') {
    const f = ajouterFeuille(wb, {
      ...commun,
      colonnes: [
        { header: 'N°', width: 10 },
        { header: 'Désignation', width: 55 },
        { header: 'Unité', width: 10, align: 'center' },
        { header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_QUANTITE },
        // Toujours présentes : vides sans prix, l'entreprise les remplit (import ACT).
        { header: 'P.U. HT (€)', width: 15, align: 'right', numFmt: FORMAT_NOMBRE },
        { header: 'Total HT (€)', width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
        ...entetesTva,
      ],
    });
    const lignes = flattenDPGF(dpgf.lots);
    for (const r of lignes) {
      const debut = [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, nombre(r.q)];
      const valeurs = [
        ...debut,
        avecPrix ? (r.pm ? 'PM' : nombre(r.pu)) : undefined,
        avecPrix ? (r.pm ? 'PM' : nombre(r.total)) : undefined,
        ...(colTva ? [r.tvaTaux, r.tvaMontant] : []),
      ];
      if (r.type === 'lot') f.ligne(valeurs, { gras: true, fond: 'groupe' });
      else if (r.type === 'chapitre') f.ligne(valeurs, { gras: true, fond: 'doux' });
      else f.ligne(valeurs, r.type === 'titre' ? { italique: true } : {});
    }
    if (avecPrix) f.total(['', 'TOTAL HT', '', '', '', dpgf.totalHT]);
    if (avecPrix) ajouterHorsBase(f, dpgf, 6, colTva ? 2 : 0);
    if (colTva) ajouterPiedTvaExcel(f, lignes, 6);
  } else {
    const f = ajouterFeuille(wb, {
      ...commun,
      colonnes: [
        { header: 'N°', width: 10 },
        { header: 'Désignation', width: 45 },
        { header: 'Lot', width: 24 },
        { header: 'Localisation', width: 20 },
        { header: 'Unité', width: 10, align: 'center' },
        { header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_QUANTITE },
        { header: 'P.U. HT (€)', width: 15, align: 'right', numFmt: FORMAT_NOMBRE },
        { header: 'Total HT (€)', width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
        ...entetesTva,
      ],
    });
    const articles = flattenDPGFGroupe(dpgf, groupement);
    for (const r of articles) {
      const debut = [r.numero, r.designation, r.lot, r.localisation, r.unite, nombre(r.q)];
      const valeurs = [
        ...debut,
        avecPrix ? (r.pm ? 'PM' : nombre(r.pu)) : undefined,
        avecPrix ? (r.pm ? 'PM' : nombre(r.total)) : undefined,
        ...(colTva ? [r.tvaTaux, r.tvaMontant] : []),
      ];
      f.ligne(valeurs, r.type === 'groupe' ? { gras: true, fond: 'groupe' } : {});
    }
    if (avecPrix) f.total(['', 'TOTAL HT', '', '', '', '', '', dpgf.totalHT]);
    if (avecPrix) ajouterHorsBase(f, dpgf, 8, colTva ? 2 : 0);
    if (colTva) ajouterPiedTvaExcel(f, articles, 8);
  }
  await enregistrerClasseur(wb, `DPGF_${dpgf.titre.replace(/\s+/g, '_')}.xlsx`, sortie);
}

// ── Estimation Excel ──────────────────────────────────────────────────────────

export async function exportEstimationtoExcel(dpgf: DPGF, projectName?: string, settings: AgencySettings = {}, sortie?: Sortie) {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const nombre = (n: number) => (n > 0 ? n : undefined);

  const detail = ajouterFeuille(wb, {
    nom: 'Détail', settings, logo,
    title: 'ESTIMATION DÉTAILLÉE',
    subtitle: projectName || dpgf.titre,
    colonnes: [
      { header: 'N°', width: 10 },
      { header: 'Désignation', width: 50 },
      { header: 'Unité', width: 10, align: 'center' },
      { header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_QUANTITE },
      { header: 'P.U. HT', width: 14, align: 'right', numFmt: FORMAT_NOMBRE },
      { header: 'Total HT', width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
      { header: `TVA ${dpgf.TVA}%`, width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
      { header: 'Total TTC', width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
    ],
  });
  for (const lot of dpgf.lots) {
    detail.ligne(
      [lot.numero, lot.titre, '', '', '', lot.sousTotal, lot.sousTotal * dpgf.TVA / 100, lot.sousTotal * (1 + dpgf.TVA / 100)],
      { gras: true, fond: 'groupe' },
    );
    for (const chap of lot.chapitres) {
      detail.ligne(['', `${chap.numero} ${chap.titre}`], { gras: true, fond: 'doux' });
      for (const ligne of chap.lignes) {
        detail.ligne([
          ligne.numero, `  ${ligne.designation}${repereStatut(ligne.pourMemoire, ligne.nature)}`, ligne.unite,
          nombre(ligne.quantite), ligne.pourMemoire ? 'PM' : nombre(ligne.prixUnitaire), ligne.pourMemoire ? 'PM' : nombre(ligne.prixTotal),
        ]);
      }
    }
  }
  detail.total(['', 'TOTAL', '', '', '', dpgf.totalHT, dpgf.totalTTC - dpgf.totalHT, dpgf.totalTTC]);
  for (const t of totauxHorsBase(dpgf)) {
    detail.ligne(['', t.libelle, '', '', '', t.total, t.total * dpgf.TVA / 100, t.total * (1 + dpgf.TVA / 100)], { gras: true });
  }

  const recap = ajouterFeuille(wb, {
    nom: 'Récapitulatif', settings, logo,
    title: 'ESTIMATION — Récapitulatif par lot',
    subtitle: projectName || dpgf.titre,
    paysage: false,
    colonnes: [
      { header: 'N° Lot', width: 10 },
      { header: 'Intitulé', width: 40 },
      { header: 'Montant HT', width: 16, align: 'right', numFmt: FORMAT_EURO },
      { header: `TVA ${dpgf.TVA}%`, width: 16, align: 'right', numFmt: FORMAT_EURO },
      { header: 'Montant TTC', width: 16, align: 'right', numFmt: FORMAT_EURO },
    ],
  });
  for (const l of dpgf.lots) {
    recap.ligne([l.numero, l.titre, l.sousTotal, l.sousTotal * dpgf.TVA / 100, l.sousTotal * (1 + dpgf.TVA / 100)]);
  }
  recap.total(['', 'TOTAL', dpgf.totalHT, dpgf.totalTTC - dpgf.totalHT, dpgf.totalTTC]);

  await enregistrerClasseur(wb, `Estimation_${dpgf.titre.replace(/\s+/g, '_')}.xlsx`, sortie);
}
