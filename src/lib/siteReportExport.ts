// ── Export PDF d'un compte rendu de chantier ─────────────────────────────────
// Reprend le format classique du CR de réunion de chantier d'architecte :
// page de garde (identification du CR, tableau de présence des intervenants,
// notes de réunion, décisions), page 2 (tableau des lots avec présence,
// effectif, retards, intempéries), puis un corps chronologique — une section
// par rubrique personnalisée, une section par lot avec ses photos en
// vignettes. En-tête, pied de page et pagination « P1|2 » du cabinet
// (pdfLetterhead.ts), présentation en nuances de gris — même principe que
// reservesExport.ts, qui sert de modèle à ce fichier.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import { loadPhotoDataUrl } from './planRender';
import { autoSaveDocument } from './autoSaveDocument';
import type { Contact, Observation, ProjectLot, ProjectStakeholder, SiteReport, SiteReportNote } from '../types';

export interface SiteReportExportProject {
  id: string;
  name: string;
  project_code?: string;
  address?: string;
  client?: string;
}

export interface ObservationsByLot {
  title: string;
  entreprise: string;
  items: Observation[];
}

export interface SiteReportExportOptions {
  onProgress?: (message: string) => void;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];
const GRIS_FOND: [number, number, number] = [243, 244, 246];

const MARGIN = 14;
const FOOTER_RESERVE = 18;
const THUMB_W = 42;
const THUMB_H = 42;
const THUMB_GAP = 4;

const sanitize = (s: string) => (s || 'compte_rendu').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

const STATUS_LABELS: Record<string, string> = { P: 'Présent', R: 'Retard', AE: 'Absent excusé', ANE: 'Absent non excusé' };

/** Statut P/R/AE/ANE déduit des champs anciens (present/excused) quand `status` est absent. */
function attendeeStatus(a: { present?: boolean; excused?: boolean; status?: string }): string {
  if (a.status) return a.status;
  if (a.present) return 'P';
  return a.excused ? 'AE' : 'ANE';
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

function contactPhones(c?: Contact | null): { mobile: string; fixe: string } {
  if (!c) return { mobile: '', fixe: '' };
  return { mobile: c.phone_mobile || '', fixe: c.phone_work || c.phone || '' };
}

export async function exportSiteReportToPDF(
  report: SiteReport,
  notes: SiteReportNote[],
  observationsByLot: ObservationsByLot[],
  project: SiteReportExportProject,
  lots: ProjectLot[],
  stakeholders: ProjectStakeholder[],
  contacts: Contact[],
  settings: AgencySettings,
  opts: SiteReportExportOptions = {},
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const progress = opts.onProgress || (() => {});
  const contactById = new Map(contacts.map(c => [c.id, c]));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title: `Compte rendu de chantier n° ${report.report_number}`,
    subtitle: project.name,
    reference: project.project_code,
    margin: MARGIN,
    logo,
  };
  const pageW = () => doc.internal.pageSize.getWidth();
  const contentW = () => pageW() - MARGIN * 2;

  // ── Page de garde ──────────────────────────────────────────────────────
  let y = drawAgencyHeader(doc, settings, letterhead);
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...GRIS_TEXTE);
  doc.text(`Compte rendu de chantier n° ${report.report_number}`, MARGIN, y);
  y += 9;

  const infos: [string, string][] = [
    ['Projet', [project.project_code, project.name].filter(Boolean).join(' - ')],
    ["Maître d'ouvrage", project.client || ''],
    ['Adresse chantier', project.address || ''],
    ['Date de la visite', fmtDate(report.date)],
    ['Météo', [report.meteo, report.temperature != null ? `${report.temperature}°C` : ''].filter(Boolean).join('  ·  ')],
    ['Prochaine réunion', report.nextMeeting || ''],
  ].filter(([, v]) => v) as [string, string][];
  doc.setFontSize(9.5);
  for (const [label, value] of infos) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_DOUX);
    doc.text(`${label} :`, MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_TEXTE);
    const lines = doc.splitTextToSize(value, contentW() - 42) as string[];
    doc.text(lines, MARGIN + 42, y);
    y += 5 * Math.max(1, lines.length);
  }
  y += 3;

  // Présence des intervenants
  progress('Tableau de présence…');
  const attendance = report.attendance || [];
  autoTable(doc, {
    startY: y,
    head: [['Rôle', 'Société / Contact', 'Adresse', 'Mobile', 'Fixe', 'Statut', 'D']],
    body: stakeholders.map(s => {
      const contact = s.contact_id ? contactById.get(s.contact_id) : undefined;
      const phones = contactPhones(contact);
      const row = attendance.find(a => (s.contact_id ? a.contact_id === s.contact_id : (!a.contact_id && a.role === s.role && a.name === s.name)));
      const status = row ? attendeeStatus(row) : '';
      return [
        s.role,
        [s.name, contact?.company_name].filter(Boolean).join(' — '),
        contact?.address || '',
        phones.mobile,
        phones.fixe,
        status ? STATUS_LABELS[status] || status : '',
        row?.diffusion ? 'X' : '',
      ];
    }),
    styles: { fontSize: 7.5, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 5: { fontStyle: 'bold' }, 6: { halign: 'center', cellWidth: 8 } },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  if (report.meetingNotes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRIS_TEXTE);
    doc.text('Notes de réunion', MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(report.meetingNotes, contentW()) as string[];
    doc.text(lines, MARGIN, y);
    y += lines.length * 4.2 + 6;
  }

  const decisions = report.decisions || [];
  if (decisions.length) {
    autoTable(doc, {
      startY: y,
      head: [["Décisions de la maîtrise d'œuvre", 'Auteur', 'Nature']],
      body: decisions.map(d => [d.texte, d.auteur || '', d.tag]),
      styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    });
  }

  // ── Page 2 : tableau des lots ──────────────────────────────────────────
  progress('Tableau des lots…');
  doc.addPage('a4', 'portrait');
  y = drawAgencyHeader(doc, settings, letterhead);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...GRIS_TEXTE);
  doc.text('Suivi des lots', MARGIN, y + 2);
  y += 7;

  const tracking = report.lot_tracking || [];
  autoTable(doc, {
    startY: y,
    head: [['N°', 'Lot', 'Entreprise', 'Téléphone', 'Statut', 'Effectif', 'Retard exéc.', 'Retard docs', 'Intempéries', 'Convoqué suiv.', 'Lieu']],
    body: [...lots].sort((a, b) => a.lot_number.localeCompare(b.lot_number, 'fr', { numeric: true })).map(lot => {
      const t = tracking.find(x => x.lot_id === lot.id);
      const contact = lot.contact_id ? contactById.get(lot.contact_id) : undefined;
      const phones = contactPhones(contact);
      const status = t?.status ? STATUS_LABELS[t.status] || t.status : '';
      return [
        lot.lot_number,
        lot.lot_title,
        lot.contact_name || '',
        phones.mobile || phones.fixe,
        status,
        t?.effectif != null ? String(t.effectif) : '',
        t?.retard_execution ? 'Oui' : '',
        t?.retard_remise_docs ? 'Oui' : '',
        t?.intemperies ? 'Oui' : '',
        t?.convoque_reunion_suivante ? 'Oui' : '',
        t?.lieu || '',
      ];
    }),
    styles: { fontSize: 7, textColor: GRIS_TEXTE, cellPadding: 1.4, overflow: 'linebreak' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 6.8 },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 0: { cellWidth: 8 }, 4: { fontStyle: 'bold' } },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
  });

  // ── Rubriques personnalisées ────────────────────────────────────────────
  const byCategory = new Map<string, SiteReportNote[]>();
  for (const n of notes) {
    if (!byCategory.has(n.category)) byCategory.set(n.category, []);
    byCategory.get(n.category)!.push(n);
  }
  if (byCategory.size > 0) {
    progress('Rubriques…');
    doc.addPage('a4', 'portrait');
    y = drawAgencyHeader(doc, settings, letterhead);
    for (const [category, items] of byCategory) {
      const sorted = [...items].sort((a, b) => (a.issue_date || '').localeCompare(b.issue_date || ''));
      if (y > doc.internal.pageSize.getHeight() - FOOTER_RESERVE - 20) {
        doc.addPage('a4', 'portrait');
        y = drawAgencyHeader(doc, settings, letterhead);
      }
      doc.setFillColor(...GRIS_FOND);
      doc.rect(MARGIN, y - 1, contentW(), 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRIS_TEXTE);
      doc.text(category.toUpperCase(), MARGIN + 2, y + 4);
      y += 10;
      autoTable(doc, {
        startY: y,
        head: [['Date', 'Texte', 'Société', 'Statut']],
        body: sorted.map(n => [fmtDate(n.issue_date), n.text || '', n.responsible_company || '', n.status]),
        styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
        headStyles: { fillColor: [90, 90, 90], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 30 }, 3: { cellWidth: 22, fontStyle: 'bold' } },
        margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }
  }

  // ── Une section par lot (historique daté + photos) ──────────────────────
  if (observationsByLot.length > 0) {
    doc.addPage('a4', 'portrait');
    y = drawAgencyHeader(doc, settings, letterhead);
  }
  const pageH = () => doc.internal.pageSize.getHeight();
  const ensureRoom = (needed: number) => {
    if (y + needed > pageH() - FOOTER_RESERVE) {
      doc.addPage('a4', 'portrait');
      y = drawAgencyHeader(doc, settings, letterhead);
    }
  };

  for (const group of observationsByLot) {
    progress(`Lot ${group.title}…`);
    ensureRoom(14);
    doc.setFillColor(...GRIS_FOND);
    doc.rect(MARGIN, y - 1, contentW(), 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRIS_TEXTE);
    doc.text(`${group.title}${group.entreprise ? ` — ${group.entreprise}` : ''}`.toUpperCase(), MARGIN + 2, y + 4);
    y += 10;

    autoTable(doc, {
      startY: y,
      head: [['Échéance', 'Description', 'Statut', 'Urgence']],
      body: group.items.map(o => [fmtDate(o.due_date), o.texte, o.statut, o.urgence === 'normal' || !o.urgence ? '' : o.urgence.toUpperCase()]),
      styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [90, 90, 90], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 22, fontStyle: 'bold' }, 3: { cellWidth: 22, fontStyle: 'bold' } },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    const photoUrls = group.items.flatMap(o => o.photos || []);
    if (photoUrls.length) {
      let col = 0;
      for (const url of photoUrls) {
        const loaded = await loadPhotoDataUrl(url);
        if (!loaded) continue;
        if (col === 4) { col = 0; y += THUMB_H + 6; }
        if (col === 0) ensureRoom(THUMB_H + 6);
        const x = MARGIN + col * (THUMB_W + THUMB_GAP);
        const ratio = loaded.width / loaded.height;
        let w = THUMB_W, h = THUMB_W / ratio;
        if (h > THUMB_H) { h = THUMB_H; w = THUMB_H * ratio; }
        try { doc.addImage(loaded.dataUrl, 'JPEG', x + (THUMB_W - w) / 2, y + (THUMB_H - h) / 2, w, h); } catch { /* image illisible : ignorée */ }
        col++;
      }
      y += THUMB_H + 8;
    }

    doc.setDrawColor(...GRIS_FILET); doc.setLineWidth(0.25);
    doc.line(MARGIN, y, pageW() - MARGIN, y);
    y += 6;
  }

  progress('Finalisation…');
  drawAgencyFooters(doc, settings, letterhead);
  const filename = `CR_${report.report_number}_${sanitize(project.name)}.pdf`;
  doc.save(filename);
  await autoSaveDocument({
    blob: doc.output('blob'),
    filename,
    name: `CR Chantier N°${report.report_number} - ${project.name}`,
    projectId: project.id,
    phase: 'DET',
    category: 'Report',
  });
}
