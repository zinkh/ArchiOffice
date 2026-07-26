// Exports for the HR pages (Suivi du temps / Congés): weekly personal timesheet
// and congés fiches as PDF (autoTable, matching proExport.ts's convention), the
// admin employee×project matrix and the monthly accountant summary as Excel
// (xlsx, matching proExport.ts's convention). jsPDF/jspdf-autotable/xlsx are
// only pulled in when an export actually runs.
import { saveAs } from 'file-saver';
import type { TimeEntry, TimeAdminMatrix, TimeMonthlySummaryEntry, LeaveBalanceAllEntry } from '../types';

export interface AgencySettings {
  agencyName?: string;
  address?: string;
  phone?: string;
  email?: string;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function formatHours(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return `${hours}h${minutes.toString().padStart(2, '0')}`;
}

function pdfHeader(doc: any, title: string, subtitle: string, agency: AgencySettings) {
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(agency.agencyName || 'Mon Agence', 14, 14);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  let y = 19;
  if (agency.address) { doc.text(agency.address, 14, y); y += 4; }
  if (agency.phone) { doc.text(`Tél : ${agency.phone}`, 14, y); y += 4; }
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, y + 6);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text(subtitle, 14, y + 12);
  doc.setTextColor(0, 0, 0);
  return y + 18;
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
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = pdfHeader(doc, 'Fiche hebdomadaire de temps travaillé', `${userName} — semaine du ${weekStartStr} au ${weekEndStr}`, agencySettings);

  const sorted = [...entries].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const rows = sorted.map(e => [
    e.entry_date,
    projectName(e.project_id),
    new Date(e.start_time).toTimeString().slice(0, 5),
    e.end_time ? new Date(e.end_time).toTimeString().slice(0, 5) : '—',
    e.end_time ? formatHours((new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000) : '—',
  ]);

  autoTable(doc, {
    startY,
    head: [['Date', 'Affaire', 'Début', 'Fin', 'Heures']],
    body: rows,
    headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    foot: [['', '', '', 'Total', formatHours(totalHours)]],
    footStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold' },
  });

  doc.save(`Fiche_hebdo_${sanitizeFilename(userName)}_${weekStartStr}.pdf`);
}

// ── Admin: hours per employee × per project (Excel) ──────────────────────────

export async function exportAdminMatrixExcel(matrix: TimeAdminMatrix, periodLabel: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const byUserProject: Record<string, number> = {};
  for (const c of matrix.cells) byUserProject[`${c.user_id}::${c.project_id || '__none__'}`] = c.hours;

  const header = ['Salarié', ...matrix.projects.map(p => p.name), 'Sans affaire', 'Total'];
  const body = matrix.employees.map(emp => {
    const projectCells = matrix.projects.map(p => byUserProject[`${emp.id}::${p.id}`] || 0);
    const noneCell = byUserProject[`${emp.id}::__none__`] || 0;
    const total = projectCells.reduce((s, v) => s + v, 0) + noneCell;
    return [emp.name, ...projectCells.map(h => Number(h.toFixed(2))), Number(noneCell.toFixed(2)), Number(total.toFixed(2))];
  });

  const wsData: any[][] = [
    [`Heures par salarié et par affaire — ${periodLabel}`],
    [],
    header,
    ...body,
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 24 }, ...matrix.projects.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Heures par affaire');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Heures_par_affaire_${sanitizeFilename(periodLabel)}.xlsx`);
}

// ── Admin: monthly total per employee, for the accountant (Excel) ────────────

export async function exportMonthlySummaryExcel(monthLabel: string, rows: TimeMonthlySummaryEntry[]): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const total = rows.reduce((s, r) => s + r.total_hours, 0);
  const wsData: any[][] = [
    [`Heures travaillées — ${monthLabel}`],
    [],
    ['Salarié', 'Heures travaillées'],
    ...rows.map(r => [r.name, Number(r.total_hours.toFixed(2))]),
    [],
    ['TOTAL', Number(total.toFixed(2))],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Heures mensuelles');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Heures_mensuelles_${sanitizeFilename(monthLabel)}.xlsx`);
}

// ── Congés: global table, all employees (PDF) ────────────────────────────────

export async function exportLeaveBalancesTablePdf(yearLabel: string, rows: LeaveBalanceAllEntry[], agencySettings: AgencySettings): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = pdfHeader(doc, 'Soldes de congés', `Situation au ${new Date().toLocaleDateString('fr-FR')} — année ${yearLabel}`, agencySettings);

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
    startY,
    head: [['Salarié', 'CP alloué', 'CP pris', 'CP restant', 'RTT alloué', 'RTT pris', 'RTT restant']],
    body,
    headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });

  doc.save(`Soldes_conges_${yearLabel}.pdf`);
}

// ── Congés: individual fiche (PDF) ────────────────────────────────────────────

export async function exportLeaveBalanceFichePdf(entry: LeaveBalanceAllEntry, agencySettings: AgencySettings): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = pdfHeader(doc, `Fiche de congés — ${entry.name}`, `Situation au ${new Date().toLocaleDateString('fr-FR')} — année ${entry.year}`, agencySettings);

  const LABELS: Record<string, string> = { conges_payes: 'Congés payés', rtt: 'RTT' };
  autoTable(doc, {
    startY,
    head: [['Type', 'Alloué', 'Pris', 'Restant']],
    body: entry.balances.map(b => [LABELS[b.leave_type] || b.leave_type, b.allocated_days, b.used_days, b.remaining_days]),
    headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });

  doc.save(`Fiche_conges_${sanitizeFilename(entry.name)}_${entry.year}.pdf`);
}
