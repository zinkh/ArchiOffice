// Exports for the HR pages (Suivi du temps / Congés): weekly personal timesheet
// and congés fiches as PDF, the admin employee×project matrix and the monthly
// accountant summary as Excel. Tous portent la charte du cabinet (en-tête,
// pied, pagination P1|2) : pdfLetterhead.ts et xlsxLetterhead.ts. jsPDF et
// ExcelJS ne sont chargés que lorsqu'un export tourne.
import type { AgencySettings as BaseAgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl, tableauGris } from './pdfLetterhead';
import {
  ajouterFeuille, chargerLogo, enregistrerClasseur, nouveauClasseur, FORMAT_NOMBRE,
} from './xlsxLetterhead';
import type { TimeEntry, TimeAdminMatrix, TimeMonthlySummaryEntry, LeaveBalanceAllEntry } from '../types';

export type AgencySettings = BaseAgencySettings;

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function formatHours(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return `${hours}h${minutes.toString().padStart(2, '0')}`;
}

// ── Weekly personal timesheet (PDF) ──────────────────────────────────────────

export async function exportWeeklyTimesheetPdf(params: {
  userName: string;
  weekStartStr: string;
  weekEndStr: string;
  entries: TimeEntry[];
  projectName: (id: string | null | undefined) => string;
  totalHours: number;
  agencySettings: AgencySettings;
}): Promise<void> {
  const { userName, weekStartStr, weekEndStr, entries, projectName, totalHours, agencySettings } = params;
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(agencySettings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const letterhead = { title: 'Fiche hebdomadaire de temps travaillé', subtitle: `${userName} — semaine du ${weekStartStr} au ${weekEndStr}`, margin: 14, logo };
  const startY = drawAgencyHeader(doc, agencySettings, letterhead);

  const sorted = [...entries].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const rows = sorted.map(e => [
    e.entry_date,
    projectName(e.project_id),
    new Date(e.start_time).toTimeString().slice(0, 5),
    e.end_time ? new Date(e.end_time).toTimeString().slice(0, 5) : '—',
    e.end_time ? formatHours((new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000) : '—',
  ]);

  autoTable(doc, {
    ...tableauGris(),
    startY,
    head: [['Date', 'Affaire', 'Début', 'Fin', 'Heures']],
    body: rows,
    styles: { fontSize: 9, textColor: [17, 24, 39], cellPadding: 2.5 },
    foot: [['', '', '', 'Total', formatHours(totalHours)]],
  });

  drawAgencyFooters(doc, agencySettings, letterhead);
  doc.save(`Fiche_hebdo_${sanitizeFilename(userName)}_${weekStartStr}.pdf`);
}

// ── Admin: hours per employee × per project (Excel) ──────────────────────────

export async function exportAdminMatrixExcel(
  matrix: TimeAdminMatrix, periodLabel: string, agencySettings: AgencySettings = {},
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(agencySettings)]);

  const byUserProject: Record<string, number> = {};
  for (const c of matrix.cells) byUserProject[`${c.user_id}::${c.project_id || '__none__'}`] = c.hours;

  const f = ajouterFeuille(wb, {
    nom: 'Heures par affaire', settings: agencySettings, logo,
    title: 'Heures par salarié et par affaire',
    subtitle: periodLabel,
    colonnes: [
      { header: 'Salarié', width: 26 },
      ...matrix.projects.map(p => ({ header: p.name, width: 14, align: 'right' as const, numFmt: FORMAT_NOMBRE })),
      { header: 'Sans affaire', width: 14, align: 'right', numFmt: FORMAT_NOMBRE },
      { header: 'Total', width: 12, align: 'right', numFmt: FORMAT_NOMBRE },
    ],
  });
  for (const emp of matrix.employees) {
    const projectCells = matrix.projects.map(p => byUserProject[`${emp.id}::${p.id}`] || 0);
    const noneCell = byUserProject[`${emp.id}::__none__`] || 0;
    const total = projectCells.reduce((s, v) => s + v, 0) + noneCell;
    f.ligne([emp.name, ...projectCells.map(h => Number(h.toFixed(2))), Number(noneCell.toFixed(2)), Number(total.toFixed(2))]);
  }

  await enregistrerClasseur(wb, `Heures_par_affaire_${sanitizeFilename(periodLabel)}.xlsx`);
}

// ── Admin: monthly total per employee, for the accountant (Excel) ────────────

export async function exportMonthlySummaryExcel(
  monthLabel: string, rows: TimeMonthlySummaryEntry[], agencySettings: AgencySettings = {},
): Promise<void> {
  const [wb, logo] = await Promise.all([nouveauClasseur(), chargerLogo(agencySettings)]);

  const f = ajouterFeuille(wb, {
    nom: 'Heures mensuelles', settings: agencySettings, logo,
    title: 'Heures travaillées',
    subtitle: monthLabel,
    paysage: false,
    colonnes: [
      { header: 'Salarié', width: 30 },
      { header: 'Heures travaillées', width: 20, align: 'right', numFmt: FORMAT_NOMBRE },
    ],
  });
  for (const r of rows) f.ligne([r.name, Number(r.total_hours.toFixed(2))]);
  f.total(['TOTAL', Number(rows.reduce((s, r) => s + r.total_hours, 0).toFixed(2))]);

  await enregistrerClasseur(wb, `Heures_mensuelles_${sanitizeFilename(monthLabel)}.xlsx`);
}

// ── Congés: global table, all employees (PDF) ────────────────────────────────

export async function exportLeaveBalancesTablePdf(yearLabel: string, rows: LeaveBalanceAllEntry[], agencySettings: AgencySettings): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(agencySettings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const letterhead = { title: 'Soldes de congés', subtitle: `Situation au ${new Date().toLocaleDateString('fr-FR')} — année ${yearLabel}`, margin: 14, logo };
  const startY = drawAgencyHeader(doc, agencySettings, letterhead);

  const findBalance = (r: LeaveBalanceAllEntry, type: 'conges_payes' | 'rtt') => r.balances.find(b => b.leave_type === type);
  const body = rows.map(r => {
    const cp = findBalance(r, 'conges_payes');
    const rtt = findBalance(r, 'rtt');
    return [
      r.name,
      cp ? cp.allocated_days : '', cp ? cp.used_days : '', cp ? cp.remaining_days : '',
      rtt ? rtt.allocated_days : '', rtt ? rtt.used_days : '', rtt ? rtt.remaining_days : '',
    ];
  });

  autoTable(doc, {
    ...tableauGris(),
    startY,
    head: [['Salarié', 'CP alloué', 'CP pris', 'CP restant', 'RTT alloué', 'RTT pris', 'RTT restant']],
    body,
    styles: { fontSize: 9, textColor: [17, 24, 39], cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });

  drawAgencyFooters(doc, agencySettings, letterhead);
  doc.save(`Soldes_conges_${yearLabel}.pdf`);
}

// ── Congés: individual fiche (PDF) ────────────────────────────────────────────

export async function exportLeaveBalanceFichePdf(entry: LeaveBalanceAllEntry, agencySettings: AgencySettings): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(agencySettings.logoUrl),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const letterhead = { title: `Fiche de congés — ${entry.name}`, subtitle: `Situation au ${new Date().toLocaleDateString('fr-FR')} — année ${entry.year}`, margin: 14, logo };
  const startY = drawAgencyHeader(doc, agencySettings, letterhead);

  const LABELS: Record<string, string> = { conges_payes: 'Congés payés', rtt: 'RTT' };
  autoTable(doc, {
    ...tableauGris(),
    startY,
    head: [['Type', 'Alloué', 'Pris', 'Restant']],
    body: entry.balances.map(b => [LABELS[b.leave_type] || b.leave_type, b.allocated_days, b.used_days, b.remaining_days]),
    styles: { fontSize: 9, textColor: [17, 24, 39], cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  drawAgencyFooters(doc, agencySettings, letterhead);
  doc.save(`Fiche_conges_${sanitizeFilename(entry.name)}_${entry.year}.pdf`);
}
