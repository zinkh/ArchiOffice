import { DPGF, Lot, Chapitre, Ligne, GroupementDpgf, LIBELLES_GROUPEMENT, NATURES_HORS_BASE, type NatureArticle, type NatureHorsBase } from '../types/dpgf';
import { grouperDpgf } from './dpgfGrouping';
import { formatQuantite } from './quantiteFormat';
import { estHorsBase, sousTotalNature, sumLigne, sumLigneNature } from '../components/pro/treeOps';
import type { AgencySettings } from './proposalExport';
import { enregistrerPdf, type Sortie } from './exportSortie';
import { ORIENTATION_DPGF, orientationPdf, type Orientation } from './exportOrientation';
import { drawAgencyHeader, drawAgencyFooters, ENTETE_REDUIT_BAS, loadLogoDataUrl, tableauGris, TABLEAU_GRIS } from './pdfLetterhead';
import { chargerPhotoCouverture, donneesPageDeGarde, drawPageDeGardePdf, type CouvertureOptions } from './pageDeGarde';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO, FORMAT_NOMBRE, FORMAT_QUANTITE,
} from './xlsxLetterhead';

// ── helpers ───────────────────────────────────────────────────────────────────

// `Intl` sépare les milliers par une espace fine insécable (U+202F) que les polices standard de jsPDF ne
// connaissent pas : elle s'y affiche « / » avec un interlettrage cassé, et le montant est tronqué dans sa
// colonne. L'espace insécable ordinaire (U+00A0) y existe et ne laisse pas couper le montant en deux lignes.
const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/\u202F/g, '\u00A0');

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

/**
 * Corps d'un tableau d'options, PSE ou variantes : mêmes colonnes que le tableau de base (N°, désignation,
 * unité, quantité, P.U., total). Sans prix (cadre de réponse des entreprises), P.U. et total restent vides.
 */
const corpsNature = (items: { ligne: Ligne }[], avecPrix = true): string[][] =>
  items.map(({ ligne: l }) => [
    l.numero,
    l.designation,
    l.unite,
    l.quantite > 0 ? formatQuantite(l.quantite) : '',
    avecPrix ? (l.pourMemoire ? 'PM' : l.prixUnitaire > 0 ? fmt(l.prixUnitaire) : '') : '',
    avecPrix ? (l.pourMemoire ? 'PM' : l.prixTotal > 0 ? fmt(l.prixTotal) : '') : '',
  ]);

/**
 * Options, PSE et variantes, à la suite du tableau de base : un tableau par nature avec son propre total.
 * Elles ne figurent jamais dans le tableau de base ni dans son total.
 */
function ecrireOptionsPdf(
  doc: any, autoTable: any, dpgf: DPGF,
  { avecPrix, styles, columnStyles }: { avecPrix: boolean; styles: Record<string, unknown>; columnStyles: Record<number, unknown> },
) {
  const marge = 14;
  let y = (doc as any).lastAutoTable.finalY + 8;
  for (const nature of NATURES_HORS_BASE) {
    const items = lignesDeNature(dpgf, nature);
    if (!items.length) continue;
    if (y + 30 > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = ENTETE_REDUIT_BAS + 4; }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TABLEAU_GRIS.texte);
    doc.text(TITRE_DETAIL_NATURE[nature], marge, y);
    const total = dpgf.lots.reduce((s, l) => s + sousTotalNature(l, nature), 0);
    autoTable(doc, {
      ...tableauGris(), showFoot: 'lastPage',
      startY: y + 3,
      head: [['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)']],
      body: corpsNature(items, avecPrix),
      styles, columnStyles,
      ...(avecPrix ? { foot: [['', LIBELLE_TOTAL_NATURE[nature], '', '', '', fmt(total) + ' €']] } : {}),
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }
}

/** Même suite pour l'Excel : une section par nature, après le total de base, montants en nombres. */
function ecrireOptionsExcel(
  f: {
    ligne: (valeurs: (string | number | undefined)[], style?: { gras?: boolean; fond?: 'groupe' | 'doux'; italique?: boolean }) => void;
    total: (valeurs: (string | number | undefined)[]) => void;
  },
  dpgf: DPGF, avecPrix: boolean,
  cellules: (l: Ligne, lot: Lot, prix: boolean) => (string | number | undefined)[],
  colonnes: number,
) {
  for (const nature of NATURES_HORS_BASE) {
    const items = lignesDeNature(dpgf, nature);
    if (!items.length) continue;
    f.ligne([]);
    f.ligne(['', TITRE_DETAIL_NATURE[nature]], { gras: true, fond: 'groupe' });
    for (const { ligne, lot } of items) f.ligne(cellules(ligne, lot, avecPrix));
    if (avecPrix) {
      const total = dpgf.lots.reduce((s, l) => s + sousTotalNature(l, nature), 0);
      f.total(['', LIBELLE_TOTAL_NATURE[nature], ...Array(colonnes - 3).fill(''), total]);
    }
  }
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
const tvaDeLigne = (l: Ligne, total = l.prixTotal): { tvaTaux?: number; tvaMontant?: number } => {
  const tvaMontant = tvaDuPoste(l.tva, total, !!l.pourMemoire);
  return tvaMontant === undefined ? {} : { tvaTaux: l.tva, tvaMontant };
};

/**
 * Montant d'un article qui porte des sous-articles : la SOMME de ses enfants, comme à l'écran, jamais un prix
 * saisi sur le parent (il est périmé dès qu'un enfant change). Pour mémoire : rien ; option, PSE ou variante :
 * la somme de ses enfants de cette nature.
 */
const sommeDesEnfants = (l: Ligne): number =>
  l.pourMemoire ? 0 : estHorsBase(l.nature) ? sumLigneNature(l, l.nature, true) : sumLigne(l);

/** Mention qui signale, dans le tableau, qu'un article n'est qu'un sous-total de ses sous-articles. */
const MENTION_SOUS_TOTAL = ' (sous-total)';

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
    // Options, PSE et variantes ne figurent pas dans le tableau de base : elles suivent dans leurs propres tableaux.
    const articlesBase = g.articles.filter(a => !estHorsBase(a.nature));
    if (!articlesBase.length) continue;
    rows.push({ type: 'groupe', numero: '', designation: g.libelle, lot: '', localisation: '', unite: '', quantite: '', prixUnitaire: '', prixTotal: fmt(g.total), q: 0, pu: 0, total: g.total, pm: false });
    for (const a of articlesBase) {
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

function flattenDPGF(lots: Lot[], sansHorsBase = false): Array<{
  depth: number;
  numero: string;
  designation: string;
  unite: string;
  quantite: string;
  prixUnitaire: string;
  prixTotal: string;
  type: string;
  /** Article qui porte des sous-articles : montant = somme de ses enfants, ni unité, ni quantité, ni P.U. */
  parent: boolean;
  q: number;
  pu: number;
  total: number;
  pm: boolean;
  tvaTaux?: number;
  tvaMontant?: number;
}> {
  const rows: ReturnType<typeof flattenDPGF> = [];
  for (const lot of lots) {
    rows.push({ depth: 0, numero: lot.numero, designation: lot.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: fmt(lot.sousTotal), type: 'lot', parent: false, q: 0, pu: 0, total: lot.sousTotal, pm: false });
    for (const chap of lot.chapitres) {
      rows.push({ depth: 1, numero: chap.numero, designation: chap.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: '', type: 'chapitre', parent: false, q: 0, pu: 0, total: 0, pm: false });
      // Descend dans les sous-articles : la version précédente s'arrêtait au
      // premier niveau et faisait disparaître silencieusement tout ce qui se
      // trouvait en dessous de chaque export PDF ou Excel.
      const walk = (lignes: Ligne[], depth: number) => {
        for (const ligne of lignes) {
          // Estimation poste par poste : options, PSE et variantes ont leur propre tableau, hors du total de base.
          if (sansHorsBase && estHorsBase(ligne.nature)) continue;
          // Un article qui porte des sous-articles n'a ni unité, ni quantité, ni prix unitaire à chiffrer :
          // « forf » et « 1,00 » laisseraient croire aux entreprises qu'elles doivent le chiffrer. Il
          // n'affiche que la somme de ses enfants, signalée comme sous-total.
          const parent = !!ligne.children?.length;
          const total = parent ? sommeDesEnfants(ligne) : ligne.prixTotal;
          rows.push({
            depth,
            numero: ligne.numero,
            designation: ligne.designation + repereStatut(ligne.pourMemoire, ligne.nature) + (parent ? MENTION_SOUS_TOTAL : ''),
            unite: parent ? '' : ligne.unite,
            quantite: !parent && ligne.quantite > 0 ? formatQuantite(ligne.quantite) : '',
            prixUnitaire: parent ? '' : ligne.pourMemoire ? 'PM' : ligne.prixUnitaire > 0 ? fmt(ligne.prixUnitaire) : '',
            prixTotal: ligne.pourMemoire ? 'PM' : total > 0 ? fmt(total) : '',
            type: ligne.type,
            parent,
            q: parent ? 0 : ligne.quantite, pu: parent ? 0 : ligne.prixUnitaire, total, pm: !!ligne.pourMemoire,
            ...tvaDeLigne(ligne, total),
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
  /** Orientation de la page A4 ; absente, horizontal comme avant. */
  orientation?: Orientation;
  /** Export d'un seul lot : ajouté au nom du fichier (« Lot 01 Gros œuvre »). */
  suffixeNom?: string;
  /** Page de garde du PDF : photo du projet, adresse, maître d'ouvrage, numéro d'affaire. */
  couverture?: CouvertureOptions;
}

/** `DPGF_<titre>[_<lot>].<ext>` : le suffixe d'un lot distingue les fichiers d'un export par lot. */
const nomDpgf = (dpgf: DPGF, suffixe: string | undefined, ext: 'pdf' | 'xlsx') =>
  `DPGF_${[dpgf.titre, suffixe].filter(Boolean).join(' ').replace(/\s+/g, '_')}.${ext}`;

export async function exportDPGFtoPDF(
  dpgf: DPGF, projectName?: string, groupement: GroupementDpgf = 'lot', settings: AgencySettings = {},
  { avecPrix = false, avecTva = false, sortie, orientation = ORIENTATION_DPGF, suffixeNom, couverture }: ExportDpgfOptions = {},
) {
  const colTva = avecPrix && avecTva;
  // En vertical, le tableau tient sur 182 mm au lieu de 269 : colonnes et corps de texte réduits.
  const etroit = orientation === 'portrait';
  const w = (mm: number) => (etroit ? Math.round(mm * 0.78) : mm);
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: orientationPdf(orientation), unit: 'mm', format: 'a4' });
  const classement = groupement !== 'lot' ? ` — Classement : ${LIBELLES_GROUPEMENT[groupement]}` : '';
  const letterhead = {
    title: 'DPGF — Décomposition du Prix Global et Forfaitaire',
    subtitle: projectName,
    reference: `v${dpgf.version}${classement}`,
    margin: 14, logo,
  };
  // Page de garde, puis le tableau à la page suivante sous l'en-tête réduit (agence | document).
  drawPageDeGardePdf(doc, settings, logo, donneesPageDeGarde({
    operation: projectName, titreDocument: dpgf.titre, intitule: 'Décomposition du Prix Global et Forfaitaire (DPGF)',
    precision: [suffixeNom, groupement !== 'lot' ? `Classement : ${LIBELLES_GROUPEMENT[groupement]}` : ''].filter(Boolean).join(' · ') || undefined,
    version: dpgf.version, dateCreation: dpgf.dateCreation, couverture, photo: await chargerPhotoCouverture(couverture?.imageUrl),
  }), letterhead.margin);
  doc.addPage();
  const startY = ENTETE_REDUIT_BAS + 4;

  if (groupement === 'lot') {
    const rows = flattenDPGF(dpgf.lots, true);
    autoTable(doc, {
      ...tableauGris(), showFoot: 'lastPage',
      ...(etroit ? { styles: { ...tableauGris().styles, fontSize: 7.5, cellPadding: 1.5 } } : {}),
      startY,
      head: [['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)', ...(colTva ? ['TVA dédiée (€)'] : [])]],
      body: rows.map(r => {
        const debut = [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, r.quantite];
        // Sans prix, P.U. et Total restent des cases vides à remplir par l'entreprise.
        return [...debut, avecPrix ? r.prixUnitaire : '', avecPrix ? r.prixTotal : '',
          ...(colTva ? [celluleTva(r.tvaTaux, r.tvaMontant)] : [])];
      }),
      columnStyles: {
        0: { cellWidth: w(20) },
        1: { cellWidth: 'auto' },
        2: { cellWidth: w(18), halign: 'center' },
        3: { cellWidth: w(22), halign: 'right' },
        4: { cellWidth: w(28), halign: 'right' },
        5: { cellWidth: w(28), halign: 'right' },
        ...(colTva ? { 6: { cellWidth: w(36), halign: 'right' } } : {}),
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
        } else if (row.parent) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = TABLEAU_GRIS.sousGroupe;
        }
      },
      ...(avecPrix ? { foot: [
        ['', 'TOTAL HT', '', '', '', fmt(dpgf.totalHT) + ' €', ...(colTva ? [''] : [])],
        ...(colTva ? piedTvaPdf(rows, 6) : []),
      ] } : {}),
    });
  } else {
    const rows = flattenDPGFGroupe(dpgf, groupement);
    autoTable(doc, {
      ...tableauGris(), showFoot: 'lastPage',
      ...(etroit ? { styles: { ...tableauGris().styles, fontSize: 7.5, cellPadding: 1.5 } } : {}),
      startY,
      head: [['N°', 'Désignation', 'Lot', 'Localisation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)', ...(colTva ? ['TVA dédiée (€)'] : [])]],
      body: rows.map(r => {
        const debut = [r.numero, r.designation, r.lot, r.localisation, r.unite, r.quantite];
        return [...debut, avecPrix ? r.prixUnitaire : '', avecPrix ? r.prixTotal : '',
          ...(colTva ? [celluleTva(r.tvaTaux, r.tvaMontant)] : [])];
      }),
      columnStyles: {
        0: { cellWidth: w(18) },
        1: { cellWidth: 'auto' },
        2: { cellWidth: w(32) },
        3: { cellWidth: w(26) },
        4: { cellWidth: w(16), halign: 'center' },
        5: { cellWidth: w(20), halign: 'right' },
        6: { cellWidth: w(26), halign: 'right' },
        7: { cellWidth: w(28), halign: 'right' },
        ...(colTva ? { 8: { cellWidth: w(36), halign: 'right' } } : {}),
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
        ...(colTva ? piedTvaPdf(rows, 8) : []),
      ] } : {}),
    });
  }

  ecrireOptionsPdf(doc, autoTable, dpgf, {
    avecPrix,
    styles: { fontSize: etroit ? 7.5 : 8, textColor: TABLEAU_GRIS.texte, cellPadding: etroit ? 1.5 : 2 },
    columnStyles: {
      0: { cellWidth: w(20) }, 1: { cellWidth: 'auto' }, 2: { cellWidth: w(18), halign: 'center' },
      3: { cellWidth: w(22), halign: 'right' }, 4: { cellWidth: w(28), halign: 'right' }, 5: { cellWidth: w(28), halign: 'right' },
    },
  });
  drawAgencyFooters(doc, settings, letterhead);
  await enregistrerPdf(doc, nomDpgf(dpgf, suffixeNom, 'pdf'), sortie);
}

// ── Estimation PDF ────────────────────────────────────────────────────────────

export interface ExportEstimationOptions {
  /**
   * Poste par poste : chaque article avec sa quantité, son prix unitaire et son total, au lieu du seul
   * récapitulatif par lot. Les options, PSE et variantes sont toujours détaillées à la suite.
   */
  detaille?: boolean;
}

const TITRE_DETAIL_NATURE: Record<NatureHorsBase, string> = {
  pse: 'Prestations supplémentaires éventuelles (PSE)',
  option: 'Options',
  variante: 'Variantes',
};

/**
 * Articles d'une nature hors base (PSE, option, variante), dans l'ordre du document. Même parcours que
 * `sumLigneNature` : la nature d'un parent vaut pour ses sous-articles, un article d'une autre nature hors
 * base n'en est pas, et un parent « pour mémoire » rend pour mémoire tout ce qu'il contient.
 */
function lignesDeNature(dpgf: DPGF, nature: NatureHorsBase): { ligne: Ligne; lot: Lot }[] {
  const out: { ligne: Ligne; lot: Lot }[] = [];
  const dans = (lignes: Ligne[], lot: Lot, actif: boolean, pm: boolean) => {
    for (const l of lignes) {
      if (l.cctpOnly || (estHorsBase(l.nature) && l.nature !== nature)) continue;
      const ici = actif || l.nature === nature;
      const pmIci = pm || !!l.pourMemoire;
      if (l.children?.length) dans(l.children, lot, ici, pmIci);
      else if (ici) out.push({ ligne: pmIci && !l.pourMemoire ? { ...l, pourMemoire: true } : l, lot });
    }
  };
  for (const lot of dpgf.lots) for (const chap of lot.chapitres) if (!chap.cctpOnly) dans(chap.lignes, lot, false, false);
  return out;
}

export async function exportEstimationtoPDF(
  dpgf: DPGF, projectName?: string, settings: AgencySettings = {}, sortie?: Sortie,
  { detaille = false }: ExportEstimationOptions = {},
) {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const letterhead = {
    title: detaille ? 'ESTIMATION — Détail poste par poste' : 'ESTIMATION — Récapitulatif par lot',
    subtitle: projectName, margin: 14, logo,
  };
  const startY = drawAgencyHeader(doc, settings, letterhead);
  const ttc = (ht: number) => ht * (1 + dpgf.TVA / 100);

  if (detaille) {
    const rows = flattenDPGF(dpgf.lots, true);
    autoTable(doc, {
      ...tableauGris(), showFoot: 'lastPage',
      startY,
      head: [['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)']],
      body: rows.map(r => [r.numero, '  '.repeat(Math.max(0, r.depth - 1)) + r.designation, r.unite, r.quantite, r.prixUnitaire, r.prixTotal]),
      styles: { fontSize: 8, textColor: TABLEAU_GRIS.texte, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 14, halign: 'center' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 26, halign: 'right' },
        5: { cellWidth: 28, halign: 'right' },
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
        } else if (row.parent) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = TABLEAU_GRIS.sousGroupe;
        }
      },
      foot: [['', 'TOTAL HT', '', '', '', fmt(dpgf.totalHT) + ' €']],
    });
  } else {
    autoTable(doc, {
      ...tableauGris(), showFoot: 'lastPage',
      startY,
      head: [['N°', 'Lot', 'Montant HT', 'Montant TTC']],
      body: dpgf.lots.map(lot => [
        lot.numero,
        lot.titre,
        fmt(lot.sousTotal) + ' €',
        fmt(ttc(lot.sousTotal)) + ' €',
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
  }

  // Ce qui suit le tableau (totaux, options) passe à la page suivante plutôt que de sortir de la feuille.
  const marge = 14;
  let y = (doc as any).lastAutoTable.finalY + 8;
  const reserver = (hauteur: number) => {
    if (y + hauteur <= doc.internal.pageSize.getHeight() - 20) return;
    doc.addPage();
    y = ENTETE_REDUIT_BAS + 4;
  };
  const horsBase = totauxHorsBase(dpgf);

  reserver(14 + horsBase.length * 6);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TABLEAU_GRIS.texte);
  doc.text(`TVA ${dpgf.TVA}% : ${fmt(dpgf.totalTTC - dpgf.totalHT)} €`, marge, y);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total TTC : ${fmt(dpgf.totalTTC)} €`, marge, y + 6);
  doc.setFont('helvetica', 'normal');
  horsBase.forEach((t, i) => {
    doc.text(`${t.libelle} : ${fmt(t.total)} € (TTC ${fmt(ttc(t.total))} €)`, marge, y + 14 + i * 6);
  });
  y += 14 + horsBase.length * 6 + 4;

  // Détail des options, PSE et variantes : un tableau par nature, hors du total de base.
  ecrireOptionsPdf(doc, autoTable, dpgf, {
    avecPrix: true,
    styles: { fontSize: 8, textColor: TABLEAU_GRIS.texte, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 18, halign: 'right' }, 4: { cellWidth: 26, halign: 'right' }, 5: { cellWidth: 28, halign: 'right' },
    },
  });

  drawAgencyFooters(doc, settings, letterhead);
  await enregistrerPdf(doc, `Estimation_${dpgf.titre.replace(/\s+/g, '_')}${detaille ? '_detaillee' : ''}.pdf`, sortie);
}

// ── DPGF Excel ────────────────────────────────────────────────────────────────

export async function exportDPGFtoExcel(
  dpgf: DPGF, projectName?: string, groupement: GroupementDpgf = 'lot', settings: AgencySettings = {},
  { avecPrix = false, avecTva = false, sortie, orientation = ORIENTATION_DPGF, suffixeNom }: ExportDpgfOptions = {},
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
    nom: 'DPGF', settings, logo, paysage: orientation === 'paysage',
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
    const lignes = flattenDPGF(dpgf.lots, true);
    for (const r of lignes) {
      const debut = [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, nombre(r.q)];
      const valeurs = [
        ...debut,
        avecPrix ? (r.pm ? 'PM' : nombre(r.pu)) : undefined,
        avecPrix ? (r.pm ? 'PM' : nombre(r.total)) : undefined,
        ...(colTva ? [r.tvaTaux, r.tvaMontant] : []),
      ];
      if (r.type === 'lot') f.ligne(valeurs, { gras: true, fond: 'groupe' });
      else if (r.type === 'chapitre' || r.parent) f.ligne(valeurs, { gras: true, fond: 'doux' });
      else f.ligne(valeurs, r.type === 'titre' ? { italique: true } : {});
    }
    if (avecPrix) f.total(['', 'TOTAL HT', '', '', '', dpgf.totalHT]);
    if (colTva) ajouterPiedTvaExcel(f, lignes, 6);
    ecrireOptionsExcel(f, dpgf, avecPrix, (l, _lot, prix) => [
      l.numero, l.designation, l.unite, nombre(l.quantite),
      prix ? (l.pourMemoire ? 'PM' : nombre(l.prixUnitaire)) : undefined,
      prix ? (l.pourMemoire ? 'PM' : nombre(l.prixTotal)) : undefined,
    ], 6);
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
    if (colTva) ajouterPiedTvaExcel(f, articles, 8);
    ecrireOptionsExcel(f, dpgf, avecPrix, (l, lot, prix) => [
      l.numero, l.designation, `${lot.numero} ${lot.titre}`, l.localisation || '', l.unite, nombre(l.quantite),
      prix ? (l.pourMemoire ? 'PM' : nombre(l.prixUnitaire)) : undefined,
      prix ? (l.pourMemoire ? 'PM' : nombre(l.prixTotal)) : undefined,
    ], 8);
  }
  await enregistrerClasseur(wb, nomDpgf(dpgf, suffixeNom, 'xlsx'), sortie);
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
  // Postes de base seulement : la feuille se somme au total de base. Options, PSE et variantes ont leur feuille.
  // Les sous-articles sont listés, un article parent n'affiche que la somme de ses enfants.
  for (const r of flattenDPGF(dpgf.lots, true)) {
    if (r.type === 'lot') {
      detail.ligne([r.numero, r.designation, '', '', '', r.total, r.total * dpgf.TVA / 100, r.total * (1 + dpgf.TVA / 100)], { gras: true, fond: 'groupe' });
    } else if (r.type === 'chapitre') {
      detail.ligne(['', `${r.numero} ${r.designation}`], { gras: true, fond: 'doux' });
    } else {
      detail.ligne([
        r.numero, `${'  '.repeat(Math.max(1, r.depth - 1))}${r.designation}`, r.unite,
        nombre(r.q), r.pm ? 'PM' : nombre(r.pu), r.pm ? 'PM' : nombre(r.total),
      ], r.parent ? { gras: true, fond: 'doux' } : {});
    }
  }
  detail.total(['', 'TOTAL', '', '', '', dpgf.totalHT, dpgf.totalTTC - dpgf.totalHT, dpgf.totalTTC]);
  for (const t of totauxHorsBase(dpgf)) {
    detail.ligne(['', t.libelle, '', '', '', t.total, t.total * dpgf.TVA / 100, t.total * (1 + dpgf.TVA / 100)], { gras: true });
  }

  // Détail des options, PSE et variantes : une section par nature, comme dans le PDF, hors du total de base.
  const natures = NATURES_HORS_BASE
    .map(nature => ({ nature, items: lignesDeNature(dpgf, nature) }))
    .filter(n => n.items.length);
  if (natures.length) {
    const options = ajouterFeuille(wb, {
      nom: 'Options et variantes', settings, logo,
      title: 'ESTIMATION — Options, PSE et variantes (non comprises dans le total)',
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
    for (const { nature, items } of natures) {
      options.ligne(['', TITRE_DETAIL_NATURE[nature]], { gras: true, fond: 'groupe' });
      for (const { ligne: l } of items) {
        const ht = l.pourMemoire ? undefined : nombre(l.prixTotal);
        options.ligne([
          l.numero, `  ${l.designation}`, l.unite, nombre(l.quantite),
          l.pourMemoire ? 'PM' : nombre(l.prixUnitaire), l.pourMemoire ? 'PM' : ht,
          ht === undefined ? undefined : ht * dpgf.TVA / 100, ht === undefined ? undefined : ht * (1 + dpgf.TVA / 100),
        ]);
      }
      const total = dpgf.lots.reduce((somme, lot) => somme + sousTotalNature(lot, nature), 0);
      options.ligne(['', LIBELLE_TOTAL_NATURE[nature], '', '', '', total, total * dpgf.TVA / 100, total * (1 + dpgf.TVA / 100)], { gras: true, fond: 'doux' });
    }
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
