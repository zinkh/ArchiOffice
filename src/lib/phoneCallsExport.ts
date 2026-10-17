// ── Export PDF et Excel du journal des appels ───────────────────────────────
// Exporte la liste TELLE QU'AFFICHÉE (filtres compris). Charte du cabinet : en-tête,
// pied, pagination « P1|2 », nuances de gris ; seul un rappel en retard est en rouge.
// Les deux formats lisent les mêmes lignes (`buildCallRows`) pour ne jamais diverger.
import { drawAgencyHeader, drawAgencyFooters, fetchAgencySettings, loadLogoDataUrl, tableauGris } from './pdfLetterhead';
import { isCallbackOverdue } from './phoneCalls';
import type { PhoneCall, Project, TeamMember } from '../types';

export interface CallExportContext {
  team: Pick<TeamMember, 'id' | 'name' | 'email'>[];
  projects: Pick<Project, 'id' | 'name'>[];
  /** Filtres actifs à l'écran, rappelés sous le titre (ex. « Statut : À traiter et en cours »). */
  filtres?: string[];
  today?: string;
}

export interface CallRow {
  date: string;
  sens: string;
  interlocuteur: string;
  objet: string;
  affaire: string;
  attribueA: string;
  statut: string;
  rappel: string;
  enRetard: boolean;
}

// Pièces remises sur papier à des tiers : français, comme les autres exports (non traduits).
const DIRECTION_LABELS: Record<PhoneCall['direction'], string> = { entrant: 'Entrant', sortant: 'Sortant' };
const STATUS_LABELS: Record<PhoneCall['status'], string> = { a_traiter: 'À traiter', en_cours: 'En cours', traite: 'Traité' };

const MARGIN = 12;
const ROUGE: [number, number, number] = [185, 28, 28];

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

const fmtDay = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

export function buildCallRows(calls: PhoneCall[], ctx: CallExportContext): CallRow[] {
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const memberName = new Map(ctx.team.map(m => [m.id, m.name || m.email]));
  const projectName = new Map(ctx.projects.map(p => [p.id, p.name]));
  return calls.map(c => ({
    date: fmtDateTime(c.called_at),
    sens: DIRECTION_LABELS[c.direction] ?? c.direction,
    interlocuteur: [c.caller_name, c.caller_company].filter(Boolean).join(' - ') + (c.caller_phone ? ` (${c.caller_phone})` : ''),
    objet: c.notes ? `${c.subject}\n${c.notes}` : c.subject,
    affaire: c.project_id ? projectName.get(c.project_id) || '' : '',
    attribueA: c.assignee_id ? memberName.get(c.assignee_id) || '' : 'Non attribué',
    statut: STATUS_LABELS[c.status] ?? c.status,
    rappel: fmtDay(c.callback_due),
    enRetard: isCallbackOverdue(c, today),
  }));
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportPhoneCallsToPDF(calls: PhoneCall[], ctx: CallExportContext): Promise<{ blob: Blob; filename: string }> {
  const [{ default: jsPDF }, { default: autoTable }, settings] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), fetchAgencySettings(),
  ]);
  const rows = buildCallRows(calls, ctx);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = { title: 'Journal des appels', margin: MARGIN, logo };

  let y = drawAgencyHeader(doc, settings, letterhead) + 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39);
  doc.text('Journal des appels', MARGIN, y);
  y += 6;

  const ouverts = rows.filter(r => r.statut !== STATUS_LABELS.traite).length;
  const retards = rows.filter(r => r.enRetard).length;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(75, 85, 99);
  doc.text([
    `${rows.length} appel${rows.length > 1 ? 's' : ''}, ${ouverts} à suivre${retards ? `, ${retards} rappel${retards > 1 ? 's' : ''} en retard` : ''}`,
    `Édité le ${new Date().toLocaleDateString('fr-FR')}`,
  ].join('   ·   '), MARGIN, y);
  y += 4.5;
  if (ctx.filtres?.length) {
    const lignes = doc.splitTextToSize(`Filtres : ${ctx.filtres.join(' ; ')}`, doc.internal.pageSize.getWidth() - MARGIN * 2) as string[];
    doc.text(lignes, MARGIN, y);
    y += 4.5 * lignes.length;
  }
  y += 2;

  const base = tableauGris(MARGIN);
  const colRappel = 7;
  autoTable(doc, {
    ...base,
    startY: y,
    head: [['Date', 'Sens', 'Interlocuteur', 'Objet', 'Affaire', 'Attribué à', 'Statut', 'Rappel']],
    body: rows.length
      ? rows.map(r => [r.date, r.sens, r.interlocuteur, r.objet, r.affaire, r.attribueA, r.statut, r.rappel])
      : [[{ content: 'Aucun appel.', colSpan: 8, styles: { fontStyle: 'italic' } }]],
    styles: { ...base.styles, fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
    columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 18 }, 2: { cellWidth: 46 }, 4: { cellWidth: 38 }, 5: { cellWidth: 32 }, 6: { cellWidth: 20, fontStyle: 'bold' }, 7: { cellWidth: 22 } },
    // Retard : seul élément en couleur.
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === colRappel && rows[data.row.index]?.enRetard) {
        data.cell.styles.textColor = ROUGE;
      }
    },
  });

  drawAgencyFooters(doc, settings, letterhead);
  return { blob: doc.output('blob'), filename: `journal-des-appels_${stamp()}.pdf` };
}

export async function exportPhoneCallsToExcel(calls: PhoneCall[], ctx: CallExportContext): Promise<void> {
  const [{ exporterListe }, settings] = await Promise.all([import('./xlsxLetterhead'), fetchAgencySettings()]);
  const rows = buildCallRows(calls, ctx);
  await exporterListe({
    fichier: `journal-des-appels_${stamp()}.xlsx`,
    nom: 'Appels',
    title: 'Journal des appels',
    subtitle: `${rows.length} appel${rows.length > 1 ? 's' : ''}`,
    settings,
    paysage: true,
    colonnes: [
      { cle: 'date', header: 'Date', width: 17 },
      { cle: 'sens', header: 'Sens', width: 10 },
      { cle: 'interlocuteur', header: 'Interlocuteur', width: 34 },
      { cle: 'objet', header: 'Objet', width: 48 },
      { cle: 'affaire', header: 'Affaire', width: 28 },
      { cle: 'attribueA', header: 'Attribué à', width: 22 },
      { cle: 'statut', header: 'Statut', width: 12 },
      { cle: 'rappel', header: 'Rappel', width: 12, align: 'center' },
    ],
    lignes: rows.map(({ enRetard: _enRetard, ...cells }) => cells),
  });
}
