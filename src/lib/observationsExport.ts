// ── Export PDF et impression de la liste des observations ───────────────────
// Imprime la liste TELLE QU'AFFICHÉE (filtres, tri, regroupement par lot) : ce que
// l'architecte voit à l'écran est ce qu'il remet. Charte du cabinet (en-tête, pied,
// pagination « P1|2 »), nuances de gris ; seul un délai dépassé est mis en rouge.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris } from './pdfLetterhead';
import { etiquetteDecoupage, type DecoupageChantier } from './chantierDecoupage';
import type { Observation } from '../types';

export interface ObservationsExportProject {
  name: string;
  project_code?: string;
  address?: string;
  client?: string;
}

export interface ObservationsGroup {
  /** Titre du groupe (lot) ; vide = liste à plat. */
  label: string;
  items: Observation[];
}

export interface ObservationsExportOptions {
  /** « Liste des observations », « Liste des réserves à lever »... */
  title: string;
  /** Filtres actifs à l'écran, rappelés sous le titre (ex. « Statut : En cours »). */
  filtres?: string[];
  decoupage?: DecoupageChantier | null;
  onProgress?: (message: string) => void;
}

export interface ObservationsPdf { blob: Blob; filename: string }

const TYPE_LABELS: Record<string, string> = { observation: 'Remarque', reserve: 'À lever', a_faire: 'Travail à faire' };
const CLOSED = ['Levée', 'Refusée'];
const MARGIN = 12;
const ROUGE: [number, number, number] = [185, 28, 28];

const sanitize = (s: string) => (s || 'observations').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

/** Délai dépassé : échéance passée et observation pas encore levée ni refusée. */
export function observationEnRetard(o: Pick<Observation, 'due_date' | 'statut'>, today = new Date()): boolean {
  if (!o.due_date || CLOSED.includes(o.statut)) return false;
  const d = new Date(o.due_date); d.setHours(0, 0, 0, 0);
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  return !isNaN(d.getTime()) && d < t;
}

export async function exportObservationsToPDF(
  groups: ObservationsGroup[],
  project: ObservationsExportProject,
  settings: AgencySettings,
  opts: ObservationsExportOptions,
): Promise<ObservationsPdf> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const progress = opts.onProgress || (() => {});
  progress('Préparation…');

  // Paysage : la liste porte jusqu'à huit colonnes.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = { title: opts.title, subtitle: project.name, reference: project.project_code, margin: MARGIN, logo };

  let y = drawAgencyHeader(doc, settings, letterhead) + 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39);
  doc.text(opts.title, MARGIN, y);
  y += 6;

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const ouvertes = groups.reduce((n, g) => n + g.items.filter(o => !CLOSED.includes(o.statut)).length, 0);
  const retard = groups.reduce((n, g) => n + g.items.filter(o => observationEnRetard(o)).length, 0);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(75, 85, 99);
  const resume = [
    [project.project_code, project.name].filter(Boolean).join(' - '),
    `${total} ligne${total > 1 ? 's' : ''}, ${ouvertes} non levée${ouvertes > 1 ? 's' : ''}${retard ? `, ${retard} en retard` : ''}`,
    `Édité le ${new Date().toLocaleDateString('fr-FR')}`,
  ].filter(Boolean).join('   ·   ');
  doc.text(resume, MARGIN, y);
  y += 4.5;
  if (opts.filtres?.length) {
    const lignes = doc.splitTextToSize(`Filtres : ${opts.filtres.join(' ; ')}`, doc.internal.pageSize.getWidth() - MARGIN * 2) as string[];
    doc.text(lignes, MARGIN, y);
    y += 4.5 * lignes.length;
  }
  y += 2;

  const avecDecoupage = groups.some(g => g.items.some(o => etiquetteDecoupage(o, opts.decoupage)));
  const head = ['N°', 'Observation', 'Nature', 'Statut', 'CR émis', 'Pour le', ...(avecDecoupage ? ['Bât. / phase'] : []), 'Levée au CR'];
  const colCount = head.length;
  const body: any[] = [];
  for (const g of groups) {
    if (g.label) body.push([{ content: g.label.toUpperCase(), colSpan: colCount, styles: { fillColor: [225, 225, 225], fontStyle: 'bold', textColor: [17, 24, 39] } }]);
    for (const o of g.items) {
      const texte = [o.texte || '', o.reponse ? `Réponse : ${o.reponse}` : ''].filter(Boolean).join('\n');
      body.push([
        o.number != null ? String(o.number) : '',
        texte,
        TYPE_LABELS[o.type || 'observation'] || '',
        o.statut,
        o.created_report_number != null ? `CR ${o.created_report_number}` : '',
        fmtDate(o.due_date),
        ...(avecDecoupage ? [etiquetteDecoupage(o, opts.decoupage)] : []),
        o.resolved_report_number != null ? `CR ${o.resolved_report_number}` : '',
      ]);
    }
  }
  if (body.length === 0) body.push([{ content: 'Aucune observation.', colSpan: colCount, styles: { fontStyle: 'italic' } }]);

  const base = tableauGris(MARGIN);
  const colDelai = 5;
  autoTable(doc, {
    ...base,
    startY: y,
    head: [head],
    body,
    styles: { ...base.styles, fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
    columnStyles: { 0: { cellWidth: 12 }, 2: { cellWidth: 26 }, 3: { cellWidth: 22, fontStyle: 'bold' }, 4: { cellWidth: 20 }, 5: { cellWidth: 22 } },
    // Retard : seul élément en couleur.
    didParseCell: data => {
      if (data.section !== 'body' || data.column.index !== colDelai) return;
      const texte = String(data.cell.text?.[0] ?? '');
      const o = groups.flatMap(g => g.items).find(x => fmtDate(x.due_date) === texte && observationEnRetard(x));
      if (texte && o) data.cell.styles.textColor = ROUGE;
    },
  });

  progress('Finalisation…');
  drawAgencyFooters(doc, settings, letterhead);
  const blob = doc.output('blob');
  return { blob, filename: `${sanitize(opts.title)}_${sanitize(project.project_code || '')}_${sanitize(project.name)}.pdf` };
}

/** Télécharge un PDF produit en mémoire. */
export function telechargerPdf(pdf: ObservationsPdf): void {
  const url = URL.createObjectURL(pdf.blob);
  const a = document.createElement('a');
  a.href = url; a.download = pdf.filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Ouvre la boîte d'impression du navigateur sur un PDF produit en mémoire (cadre invisible). */
export function imprimerPdf(pdf: ObservationsPdf): void {
  const url = URL.createObjectURL(pdf.blob);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  const nettoyer = () => { frame.remove(); URL.revokeObjectURL(url); };
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // Impression impossible dans le cadre : le PDF s'ouvre dans un onglet, l'impression s'y fait.
      window.open(url, '_blank');
    }
    setTimeout(nettoyer, 120_000);
  };
  document.body.appendChild(frame);
}
