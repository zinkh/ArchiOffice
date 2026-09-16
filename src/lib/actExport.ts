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
  corps_etat_code?: string;
  dce_transmis_le?: string;
  relance_le?: string;
  offre_recue_le?: string;
  ne_repond_pas?: boolean;
}

export interface LotRef {
  id: string;
  lot_number: string;
  lot_title: string;
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
 * référentiel FFB. Les entreprises sans `corps_etat_code` (ou dont le code
 * n'existe plus dans le référentiel) tombent dans « Non classé », en dernier.
 */
export function groupByCorpsEtat<T extends EntrepriseConsulteeExport>(
  entreprises: T[],
  corpsEtat: CorpsEtat[],
): { libelle: string; entreprises: T[] }[] {
  const byCode = new Map(corpsEtat.map(ce => [ce.code, ce]));
  const groups = new Map<string, { libelle: string; position: number; entreprises: T[] }>();

  for (const e of entreprises) {
    const ce = e.corps_etat_code ? byCode.get(e.corps_etat_code) : undefined;
    const key = ce ? ce.code : '__non_classe__';
    const libelle = ce ? ce.libelle : NON_CLASSE;
    const position = ce ? ce.position : Number.MAX_SAFE_INTEGER;
    if (!groups.has(key)) groups.set(key, { libelle, position, entreprises: [] });
    groups.get(key)!.entreprises.push(e);
  }

  return [...groups.values()]
    .sort((a, b) => a.position - b.position)
    .map(({ libelle, entreprises }) => ({ libelle, entreprises }));
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
