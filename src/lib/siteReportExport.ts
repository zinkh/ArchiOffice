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
import { attendeeStatus, lotPresenceStatus, concernedLabel, pdfOrientation } from './siteReportPresence';
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
  /** « A · PH1 » : bâtiment et phase visés par le compte-rendu (absent = toute l'opération). */
  decoupageLabel?: string;
  onProgress?: (message: string) => void;
  /** Faux : le PDF n'est pas téléchargé, l'appelant en fait autre chose (diffusion par e-mail). Vrai par défaut. */
  download?: boolean;
  /** Faux : les photos des rubriques ne sont pas imprimées. Vrai par défaut. */
  includeRubriquePhotos?: boolean;
}

export interface SiteReportPdf {
  blob: Blob;
  filename: string;
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

const STATUS_LABELS: Record<string, string> = { P: 'Présent', R: 'Retard', AE: 'Absent excusé', ANE: 'Absent non excusé', NC: 'Non convoqué' };

const OBSERVATION_TYPE_LABELS: Record<string, string> = { reserve: 'À lever', a_faire: 'À faire' };

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
): Promise<SiteReportPdf> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const progress = opts.onProgress || (() => {});
  const contactById = new Map(contacts.map(c => [c.id, c]));

  const orientation = pdfOrientation(report.pageFormat);
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
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
    ['Bâtiment / phase', opts.decoupageLabel || ''],
    ['Date de la visite', fmtDate(report.date)],
    ['Météo', [report.meteo, report.temperature != null ? `${report.temperature}°C` : ''].filter(Boolean).join('  ·  ')],
    ['Effectif total', report.effectif_total != null ? String(report.effectif_total) : ''],
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
  const lotTitles = new Set(lots.map(l => l.lot_title));
  const stakeholderRows = stakeholders.map(s => {
    const contact = s.contact_id ? contactById.get(s.contact_id) : undefined;
    const phones = contactPhones(contact);
    const row = attendance.find(a => (s.contact_id ? a.contact_id === s.contact_id : (!a.contact_id && a.role === s.role && a.name === s.name)));
    const status = row ? attendeeStatus(row) : 'P';
    return [
      s.role,
      [s.name, contact?.company_name].filter(Boolean).join(' — '),
      contact?.address || '',
      phones.mobile,
      phones.fixe,
      STATUS_LABELS[status] || status,
      row?.diffusion ? 'X' : '',
    ];
  });
  // Lignes saisies librement (ni intervenant du projet, ni lot) : elles figuraient à l'écran, jamais dans le PDF.
  const freeRows = attendance
    .filter(a => !lotTitles.has(a.role) && !stakeholders.some(s => (s.contact_id ? a.contact_id === s.contact_id : (!a.contact_id && a.role === s.role && a.name === s.name))))
    .map(a => {
      const contact = a.contact_id ? contactById.get(a.contact_id) : undefined;
      const phones = contactPhones(contact);
      const status = attendeeStatus(a);
      return [a.role, [a.name, contact?.company_name].filter(Boolean).join(' — '), contact?.address || '', phones.mobile, phones.fixe, STATUS_LABELS[status] || status, a.diffusion ? 'X' : ''];
    });
  const attendeeRows = [...stakeholderRows, ...freeRows];
  if (attendeeRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Rôle', 'Société / Contact', 'Adresse', 'Mobile', 'Fixe', 'Statut', 'D']],
      body: attendeeRows,
      styles: { fontSize: 7.5, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: GRIS_FOND },
      columnStyles: { 5: { fontStyle: 'bold' }, 6: { halign: 'center', cellWidth: 8 } },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    });
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GRIS_DOUX);
    doc.text('Aucun intervenant renseigné pour cette opération.', MARGIN, y + 3);
    (doc as any).lastAutoTable = { finalY: y + 3 };
  }
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
  doc.addPage('a4', orientation);
  y = drawAgencyHeader(doc, settings, letterhead);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...GRIS_TEXTE);
  doc.text('Suivi des lots', MARGIN, y + 2);
  y += 7;

  const tracking = report.lot_tracking || [];
  autoTable(doc, {
    startY: y,
    head: [['N°', 'Lot', 'Entreprise', 'Téléphone', 'Statut', 'Effectif', 'Retard sem. (j)', 'Retard cumulé (j)', 'Retard docs (j)', 'Intempéries (j)', 'Convoqué suiv.', 'Lieu', 'Heure', 'W/D']],
    body: [...lots].sort((a, b) => a.lot_number.localeCompare(b.lot_number, 'fr', { numeric: true })).map(lot => {
      const t = tracking.find(x => x.lot_id === lot.id);
      const contact = lot.contact_id ? contactById.get(lot.contact_id) : undefined;
      const phones = contactPhones(contact);
      const statusKey = lotPresenceStatus(lot, attendance, t?.status);
      const status = STATUS_LABELS[statusKey] || statusKey;
      return [
        lot.lot_number,
        lot.lot_title,
        lot.contact_name?.split(' - ')[0] || contact?.company_name || '',
        phones.mobile || phones.fixe,
        status,
        t?.effectif != null ? String(t.effectif) : '',
        t?.retard_semaine != null ? String(t.retard_semaine) : (t?.retard_execution && t?.retard_cumule == null ? 'Oui' : ''),
        t?.retard_cumule != null ? String(t.retard_cumule) : '',
        t?.retard_docs_jours != null ? String(t.retard_docs_jours) : (t?.retard_remise_docs ? 'Oui' : ''),
        t?.intemperies_jours != null ? String(t.intemperies_jours) : (t?.intemperies ? 'Oui' : ''),
        t?.convoque_reunion_suivante ? 'Oui' : '',
        t?.lieu ?? 'Sur site',
        t?.heure || '',
        concernedLabel(t?.concerned),
      ];
    }),
    styles: { fontSize: 7, textColor: GRIS_TEXTE, cellPadding: 1.4, overflow: 'linebreak' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 6.8 },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 0: { cellWidth: 8 }, 4: { fontStyle: 'bold' }, 13: { halign: 'center', fontStyle: 'bold' } },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
  });

  const pageH = () => doc.internal.pageSize.getHeight();
  const thumbsPerRow = () => Math.max(1, Math.floor((contentW() + THUMB_GAP) / (THUMB_W + THUMB_GAP)));
  const ensureRoom = (needed: number) => {
    if (y + needed > pageH() - FOOTER_RESERVE) {
      doc.addPage('a4', orientation);
      y = drawAgencyHeader(doc, settings, letterhead);
    }
  };
  /** Planche de vignettes (une photo illisible est ignorée) ; ne bouge pas `y` s'il n'y en a aucune. */
  const drawThumbnails = async (urls: string[]) => {
    let col = 0;
    let drawn = 0;
    for (const url of urls) {
      const loaded = await loadPhotoDataUrl(url);
      if (!loaded) continue;
      if (col === thumbsPerRow()) { col = 0; y += THUMB_H + 6; }
      if (col === 0) ensureRoom(THUMB_H + 6);
      const x = MARGIN + col * (THUMB_W + THUMB_GAP);
      const ratio = loaded.width / loaded.height;
      let w = THUMB_W, h = THUMB_W / ratio;
      if (h > THUMB_H) { h = THUMB_H; w = THUMB_H * ratio; }
      try { doc.addImage(loaded.dataUrl, 'JPEG', x + (THUMB_W - w) / 2, y + (THUMB_H - h) / 2, w, h); } catch { /* image illisible : ignorée */ }
      col++; drawn++;
    }
    if (drawn > 0) y += THUMB_H + 8;
  };

  // ── Rubriques personnalisées ────────────────────────────────────────────
  const byCategory = new Map<string, SiteReportNote[]>();
  for (const n of notes) {
    if (!byCategory.has(n.category)) byCategory.set(n.category, []);
    byCategory.get(n.category)!.push(n);
  }
  if (byCategory.size > 0) {
    progress('Rubriques…');
    doc.addPage('a4', orientation);
    y = drawAgencyHeader(doc, settings, letterhead);
    for (const [category, items] of byCategory) {
      const sorted = [...items].sort((a, b) => (a.issue_date || '').localeCompare(b.issue_date || ''));
      if (y > doc.internal.pageSize.getHeight() - FOOTER_RESERVE - 20) {
        doc.addPage('a4', orientation);
        y = drawAgencyHeader(doc, settings, letterhead);
      }
      doc.setFillColor(...GRIS_FOND);
      doc.rect(MARGIN, y - 1, contentW(), 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRIS_TEXTE);
      doc.text(category.toUpperCase(), MARGIN + 2, y + 4);
      y += 10;
      autoTable(doc, {
        startY: y,
        head: [['Date', 'Texte', 'Société', 'Échéance', 'Statut']],
        body: sorted.map(n => [
          fmtDate(n.issue_date),
          [n.lot_concerne ? `Lot : ${n.lot_concerne}` : '', n.text || n.description || ''].filter(Boolean).join('\n'),
          n.responsible_company || '',
          fmtDate(n.due_date) + (n.realization_date ? `${n.due_date ? '\n' : ''}Réalisé le ${fmtDate(n.realization_date)}` : ''),
          n.statut || n.status,
        ]),
        styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
        headStyles: { fillColor: [90, 90, 90], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 28 }, 3: { cellWidth: 22 }, 4: { cellWidth: 20, fontStyle: 'bold' } },
        margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
      if (opts.includeRubriquePhotos !== false) await drawThumbnails(sorted.flatMap(n => n.photos || []));
      y += 2;
    }
  }

  // ── Une section par lot (historique daté + photos) ──────────────────────
  if (observationsByLot.length > 0) {
    doc.addPage('a4', orientation);
    y = drawAgencyHeader(doc, settings, letterhead);
  }
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
      head: [['N°', 'Description', 'Origine', 'Échéance', 'Statut', 'Urgence']],
      body: group.items.map(o => [
        o.number != null ? String(o.number) : '',
        [OBSERVATION_TYPE_LABELS[o.type || ''] ? `[${OBSERVATION_TYPE_LABELS[o.type || '']}] ` : '', o.texte].join(''),
        [o.created_report_number != null ? `CR n° ${o.created_report_number}` : '', o.resolved_report_number != null ? `Levée au CR n° ${o.resolved_report_number}` : ''].filter(Boolean).join('\n'),
        fmtDate(o.due_date),
        o.statut,
        o.urgence === 'normal' || !o.urgence ? '' : o.urgence.toUpperCase(),
      ]),
      styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [90, 90, 90], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 24 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20, fontStyle: 'bold' }, 5: { cellWidth: 20, fontStyle: 'bold' } },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    await drawThumbnails(group.items.flatMap(o => o.photos || []));

    doc.setDrawColor(...GRIS_FILET); doc.setLineWidth(0.25);
    doc.line(MARGIN, y, pageW() - MARGIN, y);
    y += 6;
  }

  progress('Finalisation…');
  drawAgencyFooters(doc, settings, letterhead);
  const filename = `CR_${report.report_number}_${sanitize(project.name)}.pdf`;
  if (opts.download !== false) doc.save(filename);
  const blob: Blob = doc.output('blob');
  await autoSaveDocument({
    blob,
    filename,
    name: `CR Chantier N°${report.report_number} - ${project.name}`,
    projectId: project.id,
    phase: 'DET',
    category: 'Report',
  });
  return { blob, filename };
}
