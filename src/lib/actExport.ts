// ── Export PDF et Excel des entreprises consultées (module ACT) ─────────────
// Classées par corps d'état de la nomenclature FFB (ref_corps_etat, servie
// par GET /api/referentiels — voir src/types/library.ts), dans l'ordre de
// classement du référentiel, une entreprise sans corps d'état identifié
// tombant dans un groupe « Non classé » en dernier — la même convention que
// DpgfGroupedView pour un article sans bâtiment/phase.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import type { CorpsEtat } from '../types/library';

export interface EntrepriseConsulteeExport {
  id: string;
  nom: string;
  email?: string;
  lots_ids: string[];
  /** Une entreprise peut relever de plusieurs métiers de la nomenclature FFB. */
  corps_etat_codes?: string[];
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
const NON_CLASSE = 'Non classé';

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
};

const lotsLabel = (lotsIds: string[], lots: LotRef[]) =>
  lotsIds.map(id => lots.find(l => l.id === id)).filter(Boolean)
    .map(l => `Lot ${l!.lot_number}`).join(', ');

/**
 * Groupe les entreprises par corps d'état, dans l'ordre `position` du
 * référentiel FFB. Une entreprise déclarée sur plusieurs métiers apparaît
 * une fois par métier — c'est la nature même d'une classification multiple.
 * Les entreprises sans `corps_etat_codes` (ou dont aucun code n'existe plus
 * dans le référentiel) tombent dans « Non classé », en dernier.
 */
export function groupByCorpsEtat<T extends EntrepriseConsulteeExport>(
  entreprises: T[],
  corpsEtat: CorpsEtat[],
): { libelle: string; entreprises: T[] }[] {
  const byCode = new Map(corpsEtat.map(ce => [ce.code, ce]));
  const groups = new Map<string, { libelle: string; position: number; entreprises: T[] }>();

  for (const e of entreprises) {
    const codes = (e.corps_etat_codes || []).filter(c => byCode.has(c));
    if (codes.length === 0) {
      const key = '__non_classe__';
      if (!groups.has(key)) groups.set(key, { libelle: NON_CLASSE, position: Number.MAX_SAFE_INTEGER, entreprises: [] });
      groups.get(key)!.entreprises.push(e);
      continue;
    }
    for (const code of codes) {
      const ce = byCode.get(code)!;
      if (!groups.has(code)) groups.set(code, { libelle: ce.libelle, position: ce.position, entreprises: [] });
      groups.get(code)!.entreprises.push(e);
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.position - b.position)
    .map(({ libelle, entreprises }) => ({ libelle, entreprises }));
}

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

export async function exportEntreprisesConsulteesToExcel(
  entreprises: EntrepriseConsulteeExport[],
  corpsEtat: CorpsEtat[],
  lots: LotRef[],
  projectName: string,
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows: (string | undefined)[][] = [];

  rows.push([projectName]);
  rows.push([`Entreprises consultées — ${new Date().toLocaleDateString('fr-FR')}`]);
  rows.push([]);
  rows.push(['Corps d\'état', 'Entreprise', 'Email', 'Lots', 'DCE transmis le', 'Relance', 'Offre reçue le', 'Ne répond pas']);

  const groupes = groupByCorpsEtat(entreprises, corpsEtat);
  for (const groupe of groupes) {
    for (const e of groupe.entreprises) {
      rows.push([
        groupe.libelle,
        e.nom,
        e.email || '',
        lotsLabel(e.lots_ids, lots),
        fmtDate(e.dce_transmis_le),
        fmtDate(e.relance_le),
        fmtDate(e.offre_recue_le),
        e.ne_repond_pas ? 'Oui' : '',
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 22 }, { wch: 28 }, { wch: 26 }, { wch: 18 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Entreprises consultées');
  XLSX.writeFile(wb, `Entreprises_consultees_${projectName.replace(/\s+/g, '_')}.xlsx`);
}

export async function exportEntreprisesConsulteesToPDF(
  entreprises: EntrepriseConsulteeExport[],
  corpsEtat: CorpsEtat[],
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
  let y = drawAgencyHeader(doc, settings, {
    title: 'Entreprises consultées',
    subtitle: projectName,
    logo,
    margin,
  });

  const groupes = groupByCorpsEtat(entreprises, corpsEtat);
  const head = [['Entreprise', 'Lots', 'DCE transmis le', 'Relance', 'Offre reçue le', 'Ne répond pas']];
  const body: any[] = [];
  for (const groupe of groupes) {
    body.push([{ content: groupe.libelle.toUpperCase(), colSpan: 6, styles: { fillColor: [225, 225, 225], textColor: GRIS_TEXTE, fontStyle: 'bold', fontSize: 8 } }]);
    for (const e of groupe.entreprises) {
      body.push([
        e.nom,
        lotsLabel(e.lots_ids, lots),
        fmtDate(e.dce_transmis_le),
        fmtDate(e.relance_le),
        fmtDate(e.offre_recue_le),
        e.ne_repond_pas ? '✗' : '',
      ]);
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 18 },
    head,
    body,
    styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 2 },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 5: { halign: 'center' } },
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

export async function exportLotsToExcel(lots: LotRef[], projectName: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const rows: (string | number | undefined)[][] = [];

  rows.push([projectName]);
  rows.push([`Lots de travaux — ${new Date().toLocaleDateString('fr-FR')}`]);
  rows.push([]);
  rows.push(['N°', 'Désignation', 'Montant HT']);

  for (const lot of lots) {
    rows.push([lot.lot_number, lot.lot_title, (lot.base_amount || 0) + (lot.options_amount || 0)]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Lots de travaux');
  XLSX.writeFile(wb, `Lots_de_travaux_${projectName.replace(/\s+/g, '_')}.xlsx`);
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
