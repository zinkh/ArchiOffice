import { DPGF, Lot, Chapitre, Ligne, GroupementDpgf, LIBELLES_GROUPEMENT } from '../types/dpgf';
import { grouperDpgf } from './dpgfGrouping';
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, loadCotraitantLogos, tableauGris, TABLEAU_GRIS, type GroupementMember } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO, FORMAT_NOMBRE,
} from './xlsxLetterhead';

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

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
  prixTotal: string;
  /** Valeurs brutes, pour l'Excel : un montant doit y rester un nombre. */
  q: number;
  total: number;
}> {
  const rows: ReturnType<typeof flattenDPGFGroupe> = [];
  for (const [, g] of grouperDpgf(dpgf, groupement)) {
    rows.push({ type: 'groupe', numero: '', designation: g.libelle, lot: '', localisation: '', unite: '', quantite: '', prixTotal: fmt(g.total), q: 0, total: g.total });
    for (const a of g.articles) {
      rows.push({
        type: 'article',
        numero: a.ligne.numero,
        designation: a.ligne.designation,
        lot: `${a.lot.numero} ${a.lot.titre}`,
        localisation: a.ligne.localisation || '',
        unite: a.ligne.unite,
        quantite: a.ligne.quantite > 0 ? fmt(a.ligne.quantite) : '',
        prixTotal: a.ligne.prixTotal > 0 ? fmt(a.ligne.prixTotal) : '',
        q: a.ligne.quantite, total: a.ligne.prixTotal,
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
}> {
  const rows: ReturnType<typeof flattenDPGF> = [];
  for (const lot of lots) {
    rows.push({ depth: 0, numero: lot.numero, designation: lot.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: fmt(lot.sousTotal), type: 'lot', q: 0, pu: 0, total: lot.sousTotal });
    for (const chap of lot.chapitres) {
      rows.push({ depth: 1, numero: chap.numero, designation: chap.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: '', type: 'chapitre', q: 0, pu: 0, total: 0 });
      // Descend dans les sous-articles : la version précédente s'arrêtait au
      // premier niveau et faisait disparaître silencieusement tout ce qui se
      // trouvait en dessous de chaque export PDF ou Excel.
      const walk = (lignes: Ligne[], depth: number) => {
        for (const ligne of lignes) {
          rows.push({
            depth,
            numero: ligne.numero,
            designation: ligne.designation,
            unite: ligne.unite,
            quantite: ligne.quantite > 0 ? fmt(ligne.quantite) : '',
            prixUnitaire: ligne.prixUnitaire > 0 ? fmt(ligne.prixUnitaire) : '',
            prixTotal: ligne.prixTotal > 0 ? fmt(ligne.prixTotal) : '',
            type: ligne.type,
            q: ligne.quantite, pu: ligne.prixUnitaire, total: ligne.prixTotal,
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

export async function exportDPGFtoPDF(
  dpgf: DPGF, projectName?: string, groupement: GroupementDpgf = 'lot', settings: AgencySettings = {},
  cotraitants: GroupementMember[] = [],
) {
  const [{ default: jsPDF }, { default: autoTable }, logo, partnerLogos] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
    loadCotraitantLogos(cotraitants),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const classement = groupement !== 'lot' ? ` — Classement : ${LIBELLES_GROUPEMENT[groupement]}` : '';
  const letterhead = {
    title: 'DPGF — Décomposition du Prix Global et Forfaitaire',
    subtitle: projectName,
    reference: `v${dpgf.version}${classement}`,
    margin: 14, logo, partnerLogos,
  };
  const startY = drawAgencyHeader(doc, settings, letterhead);

  if (groupement === 'lot') {
    const rows = flattenDPGF(dpgf.lots);
    autoTable(doc, {
      ...tableauGris(),
      startY,
      head: [['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)']],
      body: rows.map(r => [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, r.quantite, r.prixUnitaire, r.prixTotal]),
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 28, halign: 'right' },
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
        }
      },
      foot: [['', 'TOTAL HT', '', '', '', fmt(dpgf.totalHT) + ' €']],
    });
  } else {
    const rows = flattenDPGFGroupe(dpgf, groupement);
    autoTable(doc, {
      ...tableauGris(),
      startY,
      head: [['N°', 'Désignation', 'Lot', 'Localisation', 'Unité', 'Quantité', 'Total HT (€)']],
      body: rows.map(r => [r.numero, r.designation, r.lot, r.localisation, r.unite, r.quantite, r.prixTotal]),
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 32 },
        3: { cellWidth: 26 },
        4: { cellWidth: 16, halign: 'center' },
        5: { cellWidth: 20, halign: 'right' },
        6: { cellWidth: 28, halign: 'right' },
      },
      didParseCell: (data: any) => {
        const row = rows[data.row.index];
        if (row?.type === 'groupe' && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = TABLEAU_GRIS.groupe;
        }
      },
      foot: [['', 'TOTAL HT', '', '', '', '', fmt(dpgf.totalHT) + ' €']],
    });
  }

  drawAgencyFooters(doc, settings, letterhead);
  doc.save(`DPGF_${dpgf.titre.replace(/\s+/g, '_')}.pdf`);
}

// ── Estimation PDF ────────────────────────────────────────────────────────────

export async function exportEstimationtoPDF(
  dpgf: DPGF, projectName?: string, settings: AgencySettings = {}, cotraitants: GroupementMember[] = [],
) {
  const [{ default: jsPDF }, { default: autoTable }, logo, partnerLogos] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
    loadCotraitantLogos(cotraitants),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const letterhead = { title: 'ESTIMATION — Récapitulatif par lot', subtitle: projectName, margin: 14, logo, partnerLogos };
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

  drawAgencyFooters(doc, settings, letterhead);
  doc.save(`Estimation_${dpgf.titre.replace(/\s+/g, '_')}.pdf`);
}

// ── DPGF Excel ────────────────────────────────────────────────────────────────

export async function exportDPGFtoExcel(
  dpgf: DPGF, projectName?: string, groupement: GroupementDpgf = 'lot', settings: AgencySettings = {},
) {
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
        { header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_NOMBRE },
        { header: 'P.U. HT (€)', width: 15, align: 'right', numFmt: FORMAT_NOMBRE },
        { header: 'Total HT (€)', width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
      ],
    });
    for (const r of flattenDPGF(dpgf.lots)) {
      const valeurs = [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, nombre(r.q), nombre(r.pu), nombre(r.total)];
      if (r.type === 'lot') f.ligne(valeurs, { gras: true, fond: 'groupe' });
      else if (r.type === 'chapitre') f.ligne(valeurs, { gras: true, fond: 'doux' });
      else f.ligne(valeurs, r.type === 'titre' ? { italique: true } : {});
    }
    f.total(['', 'TOTAL HT', '', '', '', dpgf.totalHT]);
  } else {
    const f = ajouterFeuille(wb, {
      ...commun,
      colonnes: [
        { header: 'N°', width: 10 },
        { header: 'Désignation', width: 45 },
        { header: 'Lot', width: 24 },
        { header: 'Localisation', width: 20 },
        { header: 'Unité', width: 10, align: 'center' },
        { header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_NOMBRE },
        { header: 'Total HT (€)', width: 16, align: 'right', numFmt: FORMAT_NOMBRE },
      ],
    });
    for (const r of flattenDPGFGroupe(dpgf, groupement)) {
      const valeurs = [r.numero, r.designation, r.lot, r.localisation, r.unite, nombre(r.q), nombre(r.total)];
      f.ligne(valeurs, r.type === 'groupe' ? { gras: true, fond: 'groupe' } : {});
    }
    f.total(['', 'TOTAL HT', '', '', '', '', dpgf.totalHT]);
  }
  await enregistrerClasseur(wb, `DPGF_${dpgf.titre.replace(/\s+/g, '_')}.xlsx`);
}

// ── Estimation Excel ──────────────────────────────────────────────────────────

export async function exportEstimationtoExcel(dpgf: DPGF, projectName?: string, settings: AgencySettings = {}) {
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
      { header: 'Quantité', width: 12, align: 'right', numFmt: FORMAT_NOMBRE },
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
          ligne.numero, `  ${ligne.designation}`, ligne.unite,
          nombre(ligne.quantite), nombre(ligne.prixUnitaire), nombre(ligne.prixTotal),
        ]);
      }
    }
  }
  detail.total(['', 'TOTAL', '', '', '', dpgf.totalHT, dpgf.totalTTC - dpgf.totalHT, dpgf.totalTTC]);

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

  await enregistrerClasseur(wb, `Estimation_${dpgf.titre.replace(/\s+/g, '_')}.xlsx`);
}
