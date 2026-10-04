// ── Export PDF et Excel des entreprises consultées (module ACT) ─────────────
// Classées par LOT de travaux (onglet PRO), dans l'ordre des lots : c'est le
// classement que l'architecte lit à l'écran et celui dont il a besoin pour
// consulter. Le PDF et l'Excel ont la même mise en page (en-tête du cabinet,
// tableau en gris, pied « P1|2 ») : l'Excel passe par xlsxLetterhead.ts.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_EURO,
} from './xlsxLetterhead';

export interface EntrepriseConsulteeExport {
  id: string;
  nom: string;
  email?: string;
  lots_ids: string[];
  dce_transmis_le?: string;
  relance_le?: string;
  offre_recue_le?: string;
  ne_repond_pas?: boolean;
}

export interface LotRef {
  id: string;
  lot_number: string;
  lot_title: string;
  contact_name?: string;
  base_amount?: number;
  options_amount?: number;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_FOND: [number, number, number] = [243, 244, 246];

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
};

const lotsLabel = (lotsIds: string[], lots: LotRef[]) =>
  lotsIds.map(id => lots.find(l => l.id === id)).filter(Boolean)
    .map(l => `Lot ${l!.lot_number}`).join(', ');

/**
 * Groupe les entreprises par lot de travaux (défini dans l'onglet PRO),
 * dans l'ordre des lots — pas par position calculée, les lots n'ayant pas de
 * classement propre au-delà de leur ordre de création. Une entreprise
 * assignée à plusieurs lots apparaît une fois par lot, même logique que le
 * classement par corps d'état ci-dessus. Une entreprise sans lot assigné (ou
 * dont le lot a depuis été supprimé) tombe dans « Sans lot assigné », en
 * dernier.
 */
export function groupByLot<T extends { lots_ids: string[] }>(
  entreprises: T[],
  lots: LotRef[],
): { key: string; libelle: string; entreprises: T[] }[] {
  const groups = lots
    .map(lot => ({
      key: lot.id,
      libelle: `Lot ${lot.lot_number} — ${lot.lot_title}`,
      entreprises: entreprises.filter(e => e.lots_ids.includes(lot.id)),
    }))
    .filter(g => g.entreprises.length > 0);

  const lotIds = new Set(lots.map(l => l.id));
  const sansLot = entreprises.filter(e => !e.lots_ids.some(id => lotIds.has(id)));
  if (sansLot.length > 0) groups.push({ key: '__sans_lot__', libelle: 'Sans lot assigné', entreprises: sansLot });

  return groups;
}

const ENTETES_ENTREPRISES = ['Entreprise', 'Email', 'Lots', 'DCE transmis le', 'Relance', 'Offre reçue le', 'Ne répond pas'];

const ligneEntreprise = (e: EntrepriseConsulteeExport, lots: LotRef[]) => [
  e.nom,
  e.email || '',
  lotsLabel(e.lots_ids, lots),
  fmtDate(e.dce_transmis_le),
  fmtDate(e.relance_le),
  fmtDate(e.offre_recue_le),
  e.ne_repond_pas ? '✗' : '',
];

export async function exportEntreprisesConsulteesToExcel(
  entreprises: EntrepriseConsulteeExport[],
  lots: LotRef[],
  settings: AgencySettings,
  projectName: string,
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const feuille = ajouterFeuille(wb, {
    nom: 'Entreprises consultées',
    settings, logo,
    title: 'Entreprises consultées',
    subtitle: projectName,
    colonnes: [
      { header: ENTETES_ENTREPRISES[0], width: 32 },
      { header: ENTETES_ENTREPRISES[1], width: 30 },
      { header: ENTETES_ENTREPRISES[2], width: 18 },
      { header: ENTETES_ENTREPRISES[3], width: 16, align: 'center' },
      { header: ENTETES_ENTREPRISES[4], width: 14, align: 'center' },
      { header: ENTETES_ENTREPRISES[5], width: 16, align: 'center' },
      { header: ENTETES_ENTREPRISES[6], width: 14, align: 'center' },
    ],
  });
  for (const groupe of groupByLot(entreprises, lots)) {
    feuille.groupe(groupe.libelle);
    for (const e of groupe.entreprises) feuille.ligne(ligneEntreprise(e, lots));
  }
  await enregistrerClasseur(wb, `Entreprises_consultees_${projectName.replace(/\s+/g, '_')}.xlsx`);
}

export async function exportEntreprisesConsulteesToPDF(
  entreprises: EntrepriseConsulteeExport[],
  lots: LotRef[],
  settings: AgencySettings,
  projectName: string,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 14;
  const y = drawAgencyHeader(doc, settings, {
    title: 'Entreprises consultées',
    subtitle: projectName,
    logo,
    margin,
  });

  const body: any[] = [];
  for (const groupe of groupByLot(entreprises, lots)) {
    body.push([{ content: groupe.libelle.toUpperCase(), colSpan: ENTETES_ENTREPRISES.length, styles: { fillColor: [225, 225, 225], textColor: GRIS_TEXTE, fontStyle: 'bold', fontSize: 8 } }]);
    for (const e of groupe.entreprises) body.push(ligneEntreprise(e, lots));
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 18 },
    head: [ENTETES_ENTREPRISES],
    body,
    styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 2 },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' } },
  });

  drawAgencyFooters(doc, settings, { title: 'Entreprises consultées', margin });
  doc.save(`Entreprises_consultees_${projectName.replace(/\s+/g, '_')}.pdf`);
}

// ── Export PDF et Excel des lots de travaux ──────────────────────────────────
// Les lots eux-mêmes (le tableau « Lots de travaux » de la phase 1) : un
// export à part de celui des entreprises consultées ci-dessus, plus simple
// puisqu'il n'y a rien à classer par corps d'état ou par métier.

const fmtMontant = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ') + ' €';

export async function exportLotsToExcel(lots: LotRef[], settings: AgencySettings, projectName: string): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(settings)]);
  const feuille = ajouterFeuille(wb, {
    nom: 'Lots de travaux',
    settings, logo,
    title: 'Lots de travaux',
    subtitle: projectName,
    paysage: false,
    colonnes: [
      { header: 'N°', width: 10 },
      { header: 'Désignation', width: 50 },
      { header: 'Montant HT', width: 18, align: 'right', numFmt: FORMAT_EURO },
    ],
  });
  for (const lot of lots) {
    feuille.ligne([lot.lot_number, lot.lot_title, (lot.base_amount || 0) + (lot.options_amount || 0)]);
  }
  await enregistrerClasseur(wb, `Lots_de_travaux_${projectName.replace(/\s+/g, '_')}.xlsx`);
}

export async function exportLotsToPDF(
  lots: LotRef[],
  settings: AgencySettings,
  projectName: string,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(settings.logoUrl),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 14;
  const y = drawAgencyHeader(doc, settings, {
    title: 'Lots de travaux',
    subtitle: projectName,
    logo,
    margin,
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 18 },
    head: [['N°', 'Désignation', 'Montant HT']],
    body: lots.map(lot => [lot.lot_number, lot.lot_title, fmtMontant((lot.base_amount || 0) + (lot.options_amount || 0))]),
    styles: { fontSize: 9, textColor: GRIS_TEXTE, cellPadding: 2.5 },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 0: { cellWidth: 20 }, 2: { halign: 'right', cellWidth: 35 } },
  });

  drawAgencyFooters(doc, settings, { title: 'Lots de travaux', margin });
  doc.save(`Lots_de_travaux_${projectName.replace(/\s+/g, '_')}.pdf`);
}
