// ── Export PDF d'une liste de réserves ───────────────────────────────────────
// Le même document que celui qu'une entreprise reçoit après une visite de
// levée de réserves : une page de garde avec le récapitulatif, un plan par
// niveau avec les repères numérotés, puis une fiche par réserve (champs,
// commentaire, extrait de plan autour du repère, photos). En-tête, pied de
// page et pagination « P1|2 » du cabinet (pdfLetterhead.ts), présentation en
// nuances de gris — le statut est le seul élément mis en évidence.
import type { AgencySettings } from './proposalExport';
import { drawAgencyHeader, drawAgencyFooters, loadLogoDataUrl } from './pdfLetterhead';
import { renderPlanWithMarkers, renderPlanExcerpt, loadPhotoDataUrl } from './planRender';
import type { Reserve, GpaReserve, Plan, ReservePhoto } from '../types';

type ReserveLike = Reserve | GpaReserve;

export interface ReservesExportProject {
  name: string;
  project_code?: string;
  address?: string;
  adresse_terrain?: string;
  cp_ville_terrain?: string;
  client?: string;
}

export interface ReservesExportOptions {
  /** « Réserves » ou « Réserves GPA » — le titre du document. */
  title: string;
  onProgress?: (message: string) => void;
}

const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];
const GRIS_FOND: [number, number, number] = [243, 244, 246];

const MARGIN = 14;
const FOOTER_RESERVE = 18; // hauteur réservée au pied de page
const THUMB_W = 42;
const THUMB_H = 42;
const THUMB_GAP = 4;

const sanitize = (s: string) => (s || 'reserves').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

export function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed)];
  } catch {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

export function reserveIsOverdue(r: ReserveLike, today = new Date()): number {
  if (r.status === 'Levée' || r.status === 'Quitus Transmis' || !r.due_date) return 0;
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  const d = new Date(r.due_date); d.setHours(0, 0, 0, 0);
  if (isNaN(d.getTime()) || d >= t) return 0;
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}

interface Thumb {
  dataUrl: string;
  width: number;
  height: number;
  caption: string;
}

export async function exportReservesToPDF(
  reserves: ReserveLike[],
  plans: Plan[],
  project: ReservesExportProject,
  settings: AgencySettings,
  opts: ReservesExportOptions,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ]);
  const progress = opts.onProgress || (() => {});
  const sorted = [...reserves].sort((a, b) => (a.number || 0) - (b.number || 0));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title: `Liste de ${opts.title.toLowerCase()}`,
    subtitle: project.name,
    reference: project.project_code,
    margin: MARGIN,
    logo,
  };

  const pageW = () => doc.internal.pageSize.getWidth();
  const pageH = () => doc.internal.pageSize.getHeight();
  const contentW = () => pageW() - MARGIN * 2;

  // ── Page de garde ──────────────────────────────────────────────────────
  let y = drawAgencyHeader(doc, settings, letterhead);
  y += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...GRIS_TEXTE);
  doc.text(`Liste de ${opts.title.toLowerCase()}`, MARGIN, y);
  y += 9;

  const adresse = project.address || [project.adresse_terrain, project.cp_ville_terrain].filter(Boolean).join(' ');
  const infos: [string, string][] = [
    ['Projet', [project.project_code, project.name].filter(Boolean).join(' - ')],
    ['Adresse chantier', adresse],
    ["Maître d'ouvrage", project.client || ''],
    ["Date d'édition", new Date().toLocaleDateString('fr-FR')],
  ].filter(([, v]) => v) as [string, string][];
  doc.setFontSize(9.5);
  for (const [label, value] of infos) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS_DOUX);
    doc.text(`${label} :`, MARGIN, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_TEXTE);
    const lines = doc.splitTextToSize(value, contentW() - 40) as string[];
    doc.text(lines, MARGIN + 40, y);
    y += 5 * Math.max(1, lines.length);
  }
  y += 3;

  const counts = {
    total: sorted.length,
    ouvertes: sorted.filter(r => r.status === 'A faire' || r.status === 'En cours').length,
    retard: sorted.filter(r => reserveIsOverdue(r) > 0).length,
    levees: sorted.filter(r => r.status === 'Levée' || r.status === 'Quitus Transmis').length,
  };
  autoTable(doc, {
    startY: y,
    head: [['Réserves', 'Ouvertes', 'En retard', 'Levées']],
    body: [[String(counts.total), String(counts.ouvertes), String(counts.retard), String(counts.levees)]],
    styles: { fontSize: 9, textColor: GRIS_TEXTE, halign: 'center' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold' },
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: 110,
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  const planById = new Map(plans.map(p => [p.id, p]));
  autoTable(doc, {
    startY: y,
    head: [['N°', 'Intitulé', 'Localisation', 'Lot / Entreprise', 'Échéance', 'Statut']],
    body: sorted.map(r => {
      const retard = reserveIsOverdue(r);
      return [
        String(r.number ?? ''),
        r.title || '',
        [r.batiment, r.local].filter(Boolean).join(' / '),
        [...parseJsonList(r.lots), ...parseJsonList(r.entreprises)].join(', '),
        `${fmtDate(r.due_date)}${retard ? ` (+${retard} j)` : ''}`,
        r.status,
      ];
    }),
    styles: { fontSize: 8, textColor: GRIS_TEXTE, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: GRIS_FOND },
    columnStyles: { 0: { cellWidth: 10, halign: 'right' }, 1: { cellWidth: 62 }, 4: { cellWidth: 24 }, 5: { cellWidth: 26, fontStyle: 'bold' } },
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_RESERVE },
  });

  // ── Plans avec repères ─────────────────────────────────────────────────
  const planIds = [...new Set(sorted.filter(r => r.plan_id && r.x != null && r.y != null).map(r => r.plan_id as string))]
    .filter(id => planById.has(id));
  for (const planId of planIds) {
    const plan = planById.get(planId)!;
    progress(`Rendu du plan ${plan.name}…`);
    const markers = sorted
      .filter(r => r.plan_id === planId && r.x != null && r.y != null)
      .map(r => ({ x: r.x as number, y: r.y as number, label: String(r.number ?? '') }));
    let image: { dataUrl: string; width: number; height: number };
    try {
      image = await renderPlanWithMarkers(plan.file_url, markers);
    } catch (err) {
      console.error('[reservesExport] Plan illisible :', plan.name, err);
      continue;
    }
    const landscape = image.width > image.height;
    doc.addPage('a4', landscape ? 'landscape' : 'portrait');
    let py = drawAgencyHeader(doc, settings, { ...letterhead, subtitle: plan.name });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...GRIS_TEXTE);
    doc.text(plan.name, MARGIN, py + 2);
    py += 6;
    const availW = contentW();
    const availH = pageH() - py - FOOTER_RESERVE;
    const scale = Math.min(availW / image.width, availH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    doc.addImage(image.dataUrl, 'JPEG', MARGIN + (availW - w) / 2, py, w, h);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS_DOUX);
    doc.text(`Repères : ${markers.map(m => m.label).join(' ; ')}`, MARGIN, Math.min(py + h + 4, pageH() - FOOTER_RESERVE + 2));
  }

  // ── Une fiche par réserve ──────────────────────────────────────────────
  if (sorted.length > 0) doc.addPage('a4', 'portrait');
  y = drawAgencyHeader(doc, settings, letterhead);

  const ensureRoom = (needed: number) => {
    if (y + needed > pageH() - FOOTER_RESERVE) {
      doc.addPage('a4', 'portrait');
      y = drawAgencyHeader(doc, settings, letterhead);
    }
  };

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    progress(`Fiche ${i + 1} / ${sorted.length}…`);

    const thumbs: Thumb[] = [];
    const plan = r.plan_id ? planById.get(r.plan_id) : undefined;
    if (plan && r.x != null && r.y != null) {
      try {
        const dataUrl = await renderPlanExcerpt(plan.file_url, r.x, r.y, String(r.number ?? ''));
        thumbs.push({ dataUrl, width: 1, height: 1, caption: plan.name });
      } catch (err) {
        console.error('[reservesExport] Extrait de plan impossible :', err);
      }
    }
    for (const photo of (r.photos || []) as ReservePhoto[]) {
      const loaded = await loadPhotoDataUrl(photo.file_url);
      if (loaded) thumbs.push({ ...loaded, caption: photo.caption || `Photo ${fmtDateTime(photo.uploaded_at)}` });
    }

    // Hauteur du bloc, pour ne jamais couper une fiche entre deux pages
    // quand elle tient sur une.
    const retard = reserveIsOverdue(r);
    const fields: [string, string][] = [
      ['Statut', `${r.status}${retard ? ` — en retard de ${retard} j` : ''}`],
      ['Lot', parseJsonList(r.lots).join(', ')],
      ['En charge', parseJsonList(r.entreprises).join(', ')],
      ['Bâtiment', r.batiment || ''],
      ['Local', r.local || ''],
      ['Créée le', fmtDate(r.created_at)],
      ["Date d'échéance", fmtDate(r.due_date)],
    ].filter(([, v]) => v) as [string, string][];
    doc.setFontSize(11);
    const titleLines = doc.splitTextToSize(r.title || '(sans titre)', contentW() - 16) as string[];
    doc.setFontSize(9);
    const descLines = r.description ? (doc.splitTextToSize(r.description, contentW() - 4) as string[]) : [];
    const thumbRows = Math.ceil(thumbs.length / 4);
    const blockH = 6 + titleLines.length * 5 + fields.length * 4.6 + (descLines.length ? descLines.length * 4 + 3 : 0)
      + thumbRows * (THUMB_H + 9) + 6;
    ensureRoom(Math.min(blockH, pageH() - FOOTER_RESERVE - 40));

    // Numéro et intitulé
    doc.setFillColor(...GRIS_FOND);
    doc.rect(MARGIN, y - 1, 14, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GRIS_TEXTE);
    doc.text(String(r.number ?? ''), MARGIN + 7, y + 4, { align: 'center' });
    doc.setFontSize(11);
    doc.text(titleLines, MARGIN + 16, y + 4);
    y += 6 + titleLines.length * 5;

    // Champs
    doc.setFontSize(9);
    for (const [label, value] of fields) {
      ensureRoom(5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS_DOUX);
      doc.text(`${label} :`, MARGIN + 2, y);
      doc.setFont('helvetica', label === 'Statut' ? 'bold' : 'normal'); doc.setTextColor(...GRIS_TEXTE);
      const lines = doc.splitTextToSize(value, contentW() - 36) as string[];
      doc.text(lines, MARGIN + 34, y);
      y += 4.6 * Math.max(1, lines.length);
    }

    // Commentaire
    if (descLines.length) {
      ensureRoom(descLines.length * 4 + 3);
      y += 1;
      doc.setFont('helvetica', 'italic'); doc.setTextColor(...GRIS_TEXTE);
      doc.text(descLines, MARGIN + 2, y);
      y += descLines.length * 4 + 2;
    }

    // Vignettes : extrait de plan puis photos, quatre par ligne
    if (thumbs.length) {
      y += 2;
      let col = 0;
      for (const t of thumbs) {
        if (col === 4) { col = 0; y += THUMB_H + 9; }
        if (col === 0) ensureRoom(THUMB_H + 9);
        const x = MARGIN + col * (THUMB_W + THUMB_GAP);
        const ratio = t.width && t.height ? t.width / t.height : 1;
        let w = THUMB_W, h = THUMB_W / ratio;
        if (h > THUMB_H) { h = THUMB_H; w = THUMB_H * ratio; }
        try {
          doc.addImage(t.dataUrl, 'JPEG', x + (THUMB_W - w) / 2, y + (THUMB_H - h) / 2, w, h);
        } catch { /* une image illisible ne doit pas emporter l'export */ }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRIS_DOUX);
        const cap = doc.splitTextToSize(t.caption, THUMB_W) as string[];
        doc.text(cap.slice(0, 2), x + THUMB_W / 2, y + THUMB_H + 3, { align: 'center' });
        col++;
      }
      y += THUMB_H + 9;
    }

    // Filet de séparation
    y += 2;
    doc.setDrawColor(...GRIS_FILET); doc.setLineWidth(0.25);
    doc.line(MARGIN, y, pageW() - MARGIN, y);
    y += 6;
  }

  progress('Finalisation…');
  drawAgencyFooters(doc, settings, letterhead);
  doc.save(`${sanitize(opts.title)}_${sanitize(project.project_code || '')}_${sanitize(project.name)}.pdf`);
}
